package com.posveci.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.pdf.PdfDocument;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.print.pdf.PrintedPdfDocument;
import android.util.Base64;

import java.io.FileOutputStream;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Imprime una imagen sola en una hoja A4, con el diálogo de impresión de
 * Android (impresoras Wi-Fi, Mopria, guardar como PDF).
 *
 * Por qué existe: dentro de la app, el WebView no imprime (window.print() no
 * hace nada). La usa Publicidad para el cartel A4: la imagen va centrada y
 * entera, con 5 mm de borde como en la web.
 */
@CapacitorPlugin(name = "ImprimirImagen")
public class ImprimirImagenPlugin extends Plugin {

    @PluginMethod
    public void imprimir(PluginCall call) {
        String datos = call.getString("base64");
        String nombre = call.getString("nombre", "POSVECI");
        if (datos == null || datos.isEmpty()) {
            call.reject("Falta la imagen");
            return;
        }
        Bitmap imagen;
        try {
            byte[] bytes = Base64.decode(datos, Base64.DEFAULT);
            imagen = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception | OutOfMemoryError e) {
            call.reject("No se pudo leer la imagen: " + e.getMessage());
            return;
        }
        if (imagen == null) {
            call.reject("No se pudo leer la imagen");
            return;
        }
        PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
        if (pm == null) {
            call.reject("Este teléfono no tiene impresión");
            return;
        }
        PrintAttributes atributos = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .build();
        // El diálogo se abre desde el hilo de la pantalla.
        getActivity().runOnUiThread(() -> {
            try {
                pm.print(nombre, new Hoja(getContext(), imagen), atributos);
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo abrir la impresión: " + e.getMessage());
            }
        });
    }

    /** Una sola página con la imagen entera y centrada. */
    private static class Hoja extends PrintDocumentAdapter {
        private static final float BORDE = 72f * 5f / 25.4f; // 5 mm, en puntos
        private final Context contexto;
        private final Bitmap imagen;
        private PrintAttributes atributos;

        Hoja(Context contexto, Bitmap imagen) {
            this.contexto = contexto;
            this.imagen = imagen;
        }

        @Override
        public void onLayout(PrintAttributes viejos, PrintAttributes nuevos, CancellationSignal cancelar,
                             LayoutResultCallback listo, Bundle extras) {
            atributos = nuevos;
            if (cancelar.isCanceled()) {
                listo.onLayoutCancelled();
                return;
            }
            PrintDocumentInfo info = new PrintDocumentInfo.Builder("cartel-posveci.pdf")
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_PHOTO)
                    .setPageCount(1)
                    .build();
            listo.onLayoutFinished(info, !nuevos.equals(viejos));
        }

        @Override
        public void onWrite(PageRange[] paginas, ParcelFileDescriptor destino, CancellationSignal cancelar,
                            WriteResultCallback listo) {
            // Comprimir una imagen grande al PDF tarda: fuera del hilo de la pantalla.
            Handler pantalla = new Handler(Looper.getMainLooper());
            PrintAttributes estos = atributos;
            new Thread(() -> {
                PrintedPdfDocument pdf = new PrintedPdfDocument(contexto, estos);
                try {
                    PdfDocument.Page pagina = pdf.startPage(0);
                    PdfDocument.PageInfo hoja = pagina.getInfo();
                    Rect util = hoja.getContentRect();
                    RectF area = new RectF(
                            Math.max(util.left, BORDE), Math.max(util.top, BORDE),
                            Math.min(util.right, hoja.getPageWidth() - BORDE),
                            Math.min(util.bottom, hoja.getPageHeight() - BORDE));
                    float f = Math.min(area.width() / imagen.getWidth(), area.height() / imagen.getHeight());
                    float w = imagen.getWidth() * f, h = imagen.getHeight() * f;
                    float x = area.left + (area.width() - w) / 2f, y = area.top + (area.height() - h) / 2f;
                    pagina.getCanvas().drawBitmap(imagen, null, new RectF(x, y, x + w, y + h), new Paint(Paint.FILTER_BITMAP_FLAG));
                    pdf.finishPage(pagina);
                    if (cancelar.isCanceled()) {
                        pantalla.post(listo::onWriteCancelled);
                        return;
                    }
                    try (FileOutputStream salida = new FileOutputStream(destino.getFileDescriptor())) {
                        pdf.writeTo(salida);
                    }
                    pantalla.post(() -> listo.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES}));
                } catch (Exception | OutOfMemoryError e) {
                    pantalla.post(() -> listo.onWriteFailed(e.getMessage()));
                } finally {
                    pdf.close();
                }
            }).start();
        }
    }
}
