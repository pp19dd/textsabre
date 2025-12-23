// ---------------------------------------------------------------------------
// reusable timing logic
// ---------------------------------------------------------------------------
// usage: Timer myTimer(340); // in ms
// in Setup: myTimer.Reset();
// in Loop: myTimer.doTick();
//          if( myTimer.Blink ) // flips every __ ms
//          if( myTimer.Run )   // executes once every __ ms
// ---------------------------------------------------------------------------
class Timer {
    private:
        unsigned long prev;
        unsigned long interval;

    public:
        bool Run = false;
        bool Blink = false;
    
        Timer(unsigned long interval) {
            this->interval = interval;
        }

        void Reset() {
            prev = millis();
            Run = false;
            Blink = false;
        }

        void doTick() {
            if( millis() - prev >= interval ) {
                prev = millis();
                Run = true;
                Blink = !this->Blink;
            } else {
                Run = false;
            }
        }
};
