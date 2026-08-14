Add-Type -AssemblyName System.Drawing

$w = 760
$h = 1500
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

$fh = New-Object System.Drawing.Font("Arial", 11, [System.Drawing.FontStyle]::Bold)
$f  = New-Object System.Drawing.Font("Arial", 10)
$fm = New-Object System.Drawing.Font("Consolas", 11)
$br = [System.Drawing.Brushes]::Black
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1)

$y = 20
$g.DrawString("EVERCRISP SNACK PRODUCTOS DE CHILE SA", $fh, $br, 90, $y); $y += 18
$g.DrawString("FABRICACION, IMPORTACION Y EXPORTACION DE PRODUCTOS ALIMENTICIOS", $f, $br, 40, $y); $y += 16
$g.DrawString("Direccion Casa Matriz: AV LOS CERRILLOS 999", $f, $br, 40, $y); $y += 16
$g.DrawString("Sucursal: RUTA A 16 NRO 4535 ALTO HOSPICIO", $f, $br, 40, $y); $y += 22

$g.DrawRectangle($pen, 470, 15, 260, 70)
$g.DrawString("Rut: 94528000-K", $f, $br, 500, 22)
$g.DrawString("FACTURA ELECTRONICA", $fh, $br, 500, 40)
$g.DrawString("N 42596004", $fh, $br, 520, 60)

$y = 120
$g.DrawString("Rut:            24480416-0", $f, $br, 30, $y)
$g.DrawString("Emision:      14/08/2026", $f, $br, 430, $y); $y += 16
$g.DrawString("Razon Social:   KEVIN PAUL JAVIER CHERO", $f, $br, 30, $y)
$g.DrawString("Vencimiento:  14/08/2026", $f, $br, 430, $y); $y += 16
$g.DrawString("Direccion:      SOTOMAYOR 1450-A", $f, $br, 30, $y)
$g.DrawString("Cod.Cliente:  0102002543", $f, $br, 430, $y); $y += 16
$g.DrawString("Comuna:         IQUIQUE", $f, $br, 30, $y)
$g.DrawString("Condicion Vta: Contado", $f, $br, 430, $y); $y += 16
$g.DrawString("Ciudad:         IQUIQUE", $f, $br, 30, $y)
$g.DrawString("Territorio:   CL0504", $f, $br, 430, $y); $y += 16
$g.DrawString("Giro:           Abarrotes", $f, $br, 30, $y)
$g.DrawString("Cod Vendedor: 0002126489", $f, $br, 430, $y); $y += 28

$g.DrawString("Codigo      Producto              Md Cant  Precio  % Desc  Desc     Total", $fm, $br, 25, $y)
$y += 6
$g.DrawLine($pen, 25, $y + 12, 735, $y + 12)
$y += 20

$lineas = @(
 "300066281  CHEEZELS 28G          UN   10     325    0.00     0     3.250",
 "300066210  RAMITAS QUESO 40G     UN    8     325    0.00     0     2.600",
 "300065833  LAYS TA 50G           UN   12     647    0.00     0     7.764",
 "300065523  LAYSORE45G            UN   11     647    0.00     0     7.117",
 "300065875  DORITOS QUESO 54G     UN   15     647    0.00     0     9.705",
 "300065873  DORITOS SWE CHI 54G   UN   15     647    0.00     0     9.705",
 "300065901  DETODITO II 64G       UN   10     647    0.00     0     6.470",
 "300065824  CHEETOSPALIT64G       UN    6     647    0.00     0     3.882",
 "300061074  DINAMITA AJL 100      UN    6     970    0.00     0     5.820",
 "300061077  DINAMITA FH 100       UN    4     970    0.00     0     3.880",
 "300066164  LAYS TA 180G          UN    2   1.750    0.00     0     3.500",
 "300064408  DORITOSQUESO 240GX14  UN    2   2.100    0.00     0     4.200",
 "300056591  TWISTOS QUE 100GX16   UN    3   1.066    0.00     0     3.198",
 "300056498  TWISTOS JAMON 100X16  UN    5   1.066    0.00     0     5.330",
 "300064334  DORITOSQUESO 200GX14  UN    2   1.750    0.00     0     3.500",
 "300064649  DORITOS QUESO285GX12  UN    2   3.029    0.00     0     6.058",
 "300054969  CHISPCP 200GX12       UN    1   1.515    0.00     0     1.515",
 "300061240  GATOLATE 200GR        UN    1   1.515    0.00     0     1.515",
 "300064405  DETODITO I 275GX11    UN    2   2.125    0.00     0     4.250",
 "300045432  TODDY 142.5           UN   21   1.133    0.00     0    23.793",
 "300036388  CABRITAS 250G         UN    2   1.515    0.00     0     3.030"
)
foreach ($l in $lineas) { $g.DrawString($l, $fm, $br, 25, $y); $y += 19 }

$g.DrawLine($pen, 25, $y + 2, 735, $y + 2)
$y += 8
$g.DrawString("Totales                          140                    0   120.982", $fm, $br, 25, $y); $y += 26
$g.DrawString("Neto        120.982", $fm, $br, 430, $y); $y += 18
$g.DrawString("IVA   19 %   22.818", $fm, $br, 430, $y); $y += 18
$g.DrawString("Total       143.800", $fm, $br, 430, $y); $y += 30

$g.DrawString("Descuento aplicado en base a politica de precios de ESP S.A.", $f, $br, 30, $y); $y += 30
$g.DrawString("Timbre Electronico SII", $f, $br, 250, $y); $y += 16
$g.DrawString("Res. 74 del 06/06/2008 - Verifique este documento: www.sii.cl", $f, $br, 130, $y)

$out = Join-Path $PSScriptRoot "factura-test.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output $out
