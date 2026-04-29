import { useEffect, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import { StarTopologyProvider } from "./StarTopologyProvider";
import * as Y from "yjs";

const signalingUrl = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:4444';
const turnUsername = import.meta.env.VITE_TURN_USERNAME || '';
const turnPassword = import.meta.env.VITE_TURN_PASSWORD || '';

export function YjsRoom(roomName: string) {

    const [isSynced, setIsSynced] = useState(false);
    const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
    const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);
    const [peerCount, setPeerCount] = useState(0);
    const [isLeader, setIsLeader] = useState(false);
    const [leaderId, setLeaderId] = useState<string | null>(null);

    useEffect(() => {
        const doc = new Y.Doc();
        setYdoc(doc);

        const indexDB = new IndexeddbPersistence(roomName, doc);
        let starProvider: StarTopologyProvider | null = null;

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

        // Wait for IndexedDB to load first, then connect via Star Topology
        indexDB.once('synced', () => {
            console.log('Local storage loaded. Connecting to peers with star topology...');
            
            starProvider = new StarTopologyProvider(roomName, doc, {
                signaling: [signalingUrl],
                peerOpts: {
                    config: {
                        iceServers: iceServers
                    }
                }
            });

            starProvider.on('synced', () => {
                console.log('Synced with peers!');
                setIsSynced(true);
            });

            starProvider.on('peers', ({ added }: { added: string[] }) => {
                const currentPeerCount = starProvider?.connectedPeers.length || 0;
                console.log('Peers changed. Connected peers:', currentPeerCount);
                setPeerCount(currentPeerCount);
                
                if (added.length > 0) {
                    console.log('New peer joined, syncing state...');
                }
            });

            starProvider.on('leaderChange', ({ isLeader: leader, leaderId: id }: { isLeader: boolean, leaderId: string }) => {
                console.log(`Leader change: ${leader ? 'This peer is now the leader' : 'This peer is a follower'} (Leader ID: ${id})`);
                setIsLeader(leader);
                setLeaderId(id);
            });
        });

        const undoM = new Y.UndoManager(doc.getMap('strokes'));
        setUndoManager(undoM);

        return () => {
            if (starProvider) starProvider.destroy();
            indexDB.destroy();
            doc.destroy();
            undoM.destroy();
        };

    }, [roomName]);

    return { ydoc, isSynced, undoManager, peerCount, isLeader, leaderId };
}