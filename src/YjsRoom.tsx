import { useEffect, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";

const signalingUrl = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:4444';
const turnUsername = import.meta.env.VITE_TURN_USERNAME || '';
const turnPassword = import.meta.env.VITE_TURN_PASSWORD || '';

export function YjsRoom(roomName: string) {

    const [isSynced, setIsSynced] = useState(false);
    const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
    const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);

    useEffect(() => {
        const doc = new Y.Doc();
        setYdoc(doc);

        const indexDB = new IndexeddbPersistence(roomName, doc);

        const iceServers: RTCIceServer[] = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ];

        if (turnUsername && turnPassword) {
            iceServers.push({
                urls: 'turn:global.relay.metered.ca:80', // Make sure this matches your Metered dashboard URL
                username: turnUsername,
                credential: turnPassword
            });
            iceServers.push({
                urls: 'turn:global.relay.metered.ca:443', // Port 443 is great for bypassing strict firewalls
                username: turnUsername,
                credential: turnPassword
            });
        }

        const webrtc = new WebrtcProvider(roomName, doc, {
            // signaling: ['ws://localhost:4444'],
            signaling: [signalingUrl],
            peerOpts: {
                config: {
                    iceServers: iceServers
                }
            }
        });
        console.log('Signaling URL:', signalingUrl);

        webrtc.on('synced', () => setIsSynced(true));
        indexDB.on('synced', () => {
            console.log('Offline data synced from local browser storage!');
        });

        const undoM = new Y.UndoManager(doc.getMap('strokes'));
        setUndoManager(undoM);

        return () => {
            webrtc.destroy();
            indexDB.destroy();
            doc.destroy();
            undoM.destroy();
        };

    }, [roomName]);

    return { ydoc, isSynced, undoManager };
}