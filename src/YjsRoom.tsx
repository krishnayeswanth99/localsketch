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
    const [peerCount, setPeerCount] = useState(0);

    useEffect(() => {
        const doc = new Y.Doc();
        setYdoc(doc);

        const indexDB = new IndexeddbPersistence(roomName, doc);
        let webrtc: WebrtcProvider | null = null;

        const iceServers: RTCIceServer[] = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ];

        if (turnUsername && turnPassword) {
            iceServers.push({
                urls: 'turn:global.relay.metered.ca:80',
                username: turnUsername,
                credential: turnPassword
            });
            iceServers.push({
                urls: 'turn:global.relay.metered.ca:443',
                username: turnUsername,
                credential: turnPassword
            });
        }

        // Wait for IndexedDB to load first, then connect to WebRTC
        indexDB.once('synced', () => {
            console.log('Local storage loaded. Connecting to peers...');
            
            webrtc = new WebrtcProvider(roomName, doc, {
                signaling: [signalingUrl],
                peerOpts: {
                    config: {
                        iceServers: iceServers
                    }
                }
            });

            let activePeers = new Set<string>();

            webrtc.on('synced', () => {
                console.log('Synced with peers!');
                setIsSynced(true);
            });

            webrtc.on('peers', ({ added, removed }: { added: string[], removed: string[] }) => {
                // Update the set of active peers
                added.forEach(peer => activePeers.add(peer));
                removed.forEach(peer => activePeers.delete(peer));
                
                const currentPeerCount = activePeers.size;
                console.log('Peers changed. Added:', added, 'Removed:', removed, 'Total peers:', currentPeerCount);
                setPeerCount(currentPeerCount);
                
                // Trigger re-sync when new peers join to ensure they get latest state
                if (added.length > 0) {
                    console.log('New peer joined, syncing state...');
                }
            });
        });

        const undoM = new Y.UndoManager(doc.getMap('strokes'));
        setUndoManager(undoM);

        return () => {
            if (webrtc) webrtc.destroy();
            indexDB.destroy();
            doc.destroy();
            undoM.destroy();
        };

    }, [roomName]);

    return { ydoc, isSynced, undoManager, peerCount };
}