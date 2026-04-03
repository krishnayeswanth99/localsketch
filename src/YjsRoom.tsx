import { useEffect, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebrtcProvider } from "y-webrtc";
import * as Y from "yjs";

const signalingUrl = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:4444';

export function YjsRoom(roomName: string) {

    const [isSynced, setIsSynced] = useState(false);
    const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
    const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);

    useEffect(() => {
        const doc = new Y.Doc();
        setYdoc(doc);

        const indexDB = new IndexeddbPersistence(roomName, doc);

        const webrtc = new WebrtcProvider(roomName, doc, {
            // signaling: ['ws://localhost:4444'],
            signaling: [signalingUrl],
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