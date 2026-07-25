// Unthrottled Background Web Worker Clock for PWA Screen-Off Execution
let activeTimer = null;
let currentTargetTimeMs = null;
let currentTrackId = null;

self.onmessage = function(e) {
    const data = e.data;
    if (!data) return;

    if (data.command === 'schedule') {
        currentTargetTimeMs = data.targetTimeMs;
        currentTrackId = data.trackId;

        if (activeTimer) {
            clearInterval(activeTimer);
        }

        activeTimer = setInterval(function() {
            if (currentTargetTimeMs && Date.now() >= currentTargetTimeMs) {
                clearInterval(activeTimer);
                activeTimer = null;
                self.postMessage({
                    event: 'trackEndTrigger',
                    trackId: currentTrackId
                });
                currentTargetTimeMs = null;
            }
        }, 100);
    } else if (data.command === 'cancel') {
        if (activeTimer) {
            clearInterval(activeTimer);
            activeTimer = null;
        }
        currentTargetTimeMs = null;
        currentTrackId = null;
    }
};
