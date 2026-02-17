import { useEffect, useRef } from 'react';

/**
 * Custom hook to handle barcode scanner input.
 * Maintains a buffer of keystrokes and triggers a callback when 'Enter' is pressed.
 * Designed to work with standard HID barcode scanners that act as keyboards.
 * 
 * @param {Function} onScan - Callback function to execute when a barcode is scanned. Receives the scanned code string.
 * @param {Object} options - Configuration options.
 * @param {number} options.minLength - Minimum length of a valid barcode (default: 3).
 * @param {number} options.timeOut - Timeout in ms to clear buffer if typing stops (default: 100ms - scanners are fast).
 */
export const useBarcodeScanner = (onScan, options = {}) => {
    const { minLength = 3, timeOut = 100 } = options;

    // Use refs to keep state mutable without triggering re-renders of the effect
    const buffer = useRef('');
    const lastKeyTime = useRef(Date.now());

    // Keep the callback fresh without restarting the effect
    const callbackRef = useRef(onScan);
    useEffect(() => {
        callbackRef.current = onScan;
    }, [onScan]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            const currentTime = Date.now();
            const target = e.target;

            // Ignore input if user is typing in a text field
            // Exception: If the scanner generates the event, it might target the body, but if focus is on input, target is input.
            // We usually want to ignore manual typing in inputs, but scanners might type THERE too.
            // For a "global" scanner listener specifically for POS:
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
                // If checking for specific "scanner-like" speed could be an option, but risky.
                // Standard behavior: If focused on search, let search handle it. 
                // PREVENT global listener from stealing/doubling.
                return;
            }

            // Calculate time since last key press
            const timeDiff = currentTime - lastKeyTime.current;

            // If time difference is too large, reset buffer (it was a manual keypress or new scan)
            if (timeDiff > timeOut) {
                buffer.current = '';
            }

            lastKeyTime.current = currentTime;

            if (e.key === 'Enter') {
                // If buffer is valid, trigger scan
                if (buffer.current.length >= minLength) {
                    // Prevent default form submission if any
                    e.preventDefault();

                    const code = buffer.current;
                    console.log('🔫 Scan Detected:', code);

                    if (callbackRef.current) {
                        callbackRef.current(code);
                    }

                    buffer.current = '';
                }
            } else if (e.key.length === 1) {
                // Collect printable characters
                buffer.current += e.key;
            } else {
                // Non-printable keys (Shift, Ctrl, etc.) - Do nothing or reset?
                // Usually ignore.
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [minLength, timeOut]);
};

export default useBarcodeScanner;
