package com.posveci.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // Registra el lector de impresoras ya emparejadas (ver PairedPrintersPlugin).
        registerPlugin(PairedPrintersPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
