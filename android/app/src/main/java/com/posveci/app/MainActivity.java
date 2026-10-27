package com.posveci.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Registra el lector de impresoras ya emparejadas (ver PairedPrintersPlugin).
        registerPlugin(PairedPrintersPlugin.class);
        // Guarda imágenes en la galería: el WebView ignora <a download> (ver GuardarImagenPlugin).
        registerPlugin(GuardarImagenPlugin.class);
        // Imprime el cartel A4 de Publicidad: el WebView no imprime (ver ImprimirImagenPlugin).
        registerPlugin(ImprimirImagenPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
