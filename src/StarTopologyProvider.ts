/**
 * Star Topology WebRTC Provider for Yjs
 * 
 * Implements a leader-based architecture where:
 * - One peer is elected as the leader (star center)
 * - All other peers connect only to the leader
 * - This reduces connections from O(n²) to O(n)
 * 
 * Leader election: Sticky leadership - once elected, leader stays until disconnection
 */

import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { Awareness } from 'y-protocols/awareness';

const messageSync = 0;
const messageAwareness = 1;

interface SignalingMessage {
  type: 'announce' | 'signal' | 'leave';
  from: string;
  to?: string;
  signal?: any;
  room: string;
}

interface PeerConnection {
  peer: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  synced: boolean;
}

export class StarTopologyProvider {
  public doc: Y.Doc;
  public awareness: Awareness;
  public roomName: string;
  public peerId: string;
  
  private signalingUrl: string;
  private signalingWs: WebSocket | null = null;
  private peers: Map<string, PeerConnection> = new Map();
  private knownPeerIds: Set<string> = new Set();
  private isLeader: boolean = false;
  private leaderId: string | null = null;
  private iceServers: RTCIceServer[];
  private synced: boolean = false;
  
  private eventHandlers: Map<string, Set<Function>> = new Map();

  constructor(
    roomName: string,
    doc: Y.Doc,
    options: {
      signaling: string[];
      peerOpts?: { config?: { iceServers?: RTCIceServer[] } };
      awareness?: Awareness;
    }
  ) {
    this.doc = doc;
    this.roomName = roomName;
    this.awareness = options.awareness || new Awareness(doc);
    this.signalingUrl = options.signaling[0];
    this.iceServers = options.peerOpts?.config?.iceServers || [];
    
    // Generate unique peer ID
    this.peerId = this.generatePeerId();
    
    this.connectToSignaling();
    this.setupDocumentListeners();
  }

  private generatePeerId(): string {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  private connectToSignaling() {
    this.signalingWs = new WebSocket(this.signalingUrl);
    
    this.signalingWs.onopen = () => {
      console.log('[StarTopology] Connected to signaling server');
      this.announce();
    };
    
    this.signalingWs.onmessage = (event) => {
      this.handleSignalingMessage(JSON.parse(event.data));
    };
    
    this.signalingWs.onclose = () => {
      console.log('[StarTopology] Signaling connection closed, reconnecting...');
      setTimeout(() => this.connectToSignaling(), 1000);
    };
  }

  private announce() {
    this.sendSignaling({
      type: 'announce',
      from: this.peerId,
      room: this.roomName
    });
  }

  private sendSignaling(message: SignalingMessage) {
    if (this.signalingWs?.readyState === WebSocket.OPEN) {
      this.signalingWs.send(JSON.stringify(message));
    }
  }

  private async handleSignalingMessage(message: SignalingMessage) {
    if (message.room !== this.roomName) return;

    switch (message.type) {
      case 'announce':
        if (message.from !== this.peerId) {
          this.handlePeerAnnounce(message.from);
        }
        break;
        
      case 'signal':
        if (message.to === this.peerId && message.signal) {
          await this.handleSignal(message.from, message.signal);
        }
        break;
        
      case 'leave':
        if (message.from !== this.peerId) {
          this.handlePeerLeave(message.from);
        }
        break;
    }
  }

  private handlePeerAnnounce(peerId: string) {
    this.knownPeerIds.add(peerId);
    
    const oldLeaderId = this.leaderId;
    this.updateLeadership();
    const leaderChanged = oldLeaderId !== this.leaderId;
    
    // Announce ourselves back
    this.sendSignaling({
      type: 'announce',
      from: this.peerId,
      room: this.roomName
    });
    
    // Decide if we should connect to this peer
    this.evaluateConnection(peerId);
    
    // If a new peer joined but leadership didn't change, no topology disruption
    if (!leaderChanged) {
      console.log(`[StarTopology] Peer ${peerId} joined (leadership stable)`);
    }
    
    this.emitPeersChanged();
  }

  private handlePeerLeave(peerId: string) {
    this.knownPeerIds.delete(peerId);
    
    const peerConn = this.peers.get(peerId);
    if (peerConn) {
      peerConn.peer.close();
      this.peers.delete(peerId);
    }
    
    const wasLeaderId = this.leaderId;
    this.updateLeadership();
    this.emitPeersChanged();
    
    // If the leader changed (old leader left), reconnect to appropriate peers
    const leaderChanged = wasLeaderId !== this.leaderId;
    
    if (leaderChanged) {
      console.log(`[StarTopology] Leader changed from ${wasLeaderId} to ${this.leaderId}, re-evaluating connections...`);
      // Re-evaluate all connections for the new topology
      this.knownPeerIds.forEach(id => this.evaluateConnection(id));
    } else if (this.isLeader) {
      // If we're the leader and a follower left, no need to reconnect
      // But if we just became leader, connect to all peers
      this.knownPeerIds.forEach(id => this.evaluateConnection(id));
    }
  }

  private updateLeadership() {
    // Add ourselves to the known peers for election
    const allPeers = Array.from(this.knownPeerIds).concat([this.peerId]);
    
    const wasLeader = this.isLeader;
    const oldLeaderId = this.leaderId;
    
    // Sticky leadership: keep current leader if still available
    if (this.leaderId && allPeers.includes(this.leaderId)) {
      // Current leader is still present, keep them
      this.isLeader = this.peerId === this.leaderId;
    } else {
      // No current leader or they left, elect new one (smallest ID)
      allPeers.sort();
      this.leaderId = allPeers[0];
      this.isLeader = this.peerId === this.leaderId;
    }
    
    if (this.isLeader !== wasLeader || oldLeaderId !== this.leaderId) {
      console.log(`[StarTopology] Leadership changed: ${this.isLeader ? 'I am the leader' : 'I am a follower'} (leader: ${this.leaderId})`);
      this.emit('leaderChange', { isLeader: this.isLeader, leaderId: this.leaderId });
    }
  }

  private evaluateConnection(peerId: string) {
    // Already connected?
    if (this.peers.has(peerId)) return;
    
    // Star topology logic:
    // - If I'm the leader, connect to everyone
    // - If I'm not the leader, only connect to the leader
    // - To avoid duplicate connections, only the lower ID initiates
    
    const shouldConnect = this.isLeader || peerId === this.leaderId;
    const shouldInitiate = shouldConnect && this.peerId < peerId;
    
    if (shouldInitiate) {
      console.log(`[StarTopology] Initiating connection to peer ${peerId}`);
      this.createOffer(peerId);
    }
  }

  private async createOffer(peerId: string) {
    const peer = new RTCPeerConnection({ iceServers: this.iceServers });
    const peerConn: PeerConnection = { peer, synced: false };
    this.peers.set(peerId, peerConn);
    
    // Create data channel
    const dataChannel = peer.createDataChannel('yjs-sync');
    peerConn.dataChannel = dataChannel;
    this.setupDataChannel(peerId, dataChannel);
    
    // ICE candidate handling
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'signal',
          from: this.peerId,
          to: peerId,
          room: this.roomName,
          signal: { type: 'ice-candidate', candidate: event.candidate }
        });
      }
    };
    
    // Create and send offer
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    
    this.sendSignaling({
      type: 'signal',
      from: this.peerId,
      to: peerId,
      room: this.roomName,
      signal: { type: 'offer', sdp: offer }
    });
  }

  private async handleSignal(fromPeerId: string, signal: any) {
    if (signal.type === 'offer') {
      await this.handleOffer(fromPeerId, signal.sdp);
    } else if (signal.type === 'answer') {
      const peerConn = this.peers.get(fromPeerId);
      if (peerConn) {
        await peerConn.peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      }
    } else if (signal.type === 'ice-candidate') {
      const peerConn = this.peers.get(fromPeerId);
      if (peerConn && signal.candidate) {
        await peerConn.peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    }
  }

  private async handleOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    const peer = new RTCPeerConnection({ iceServers: this.iceServers });
    const peerConn: PeerConnection = { peer, synced: false };
    this.peers.set(fromPeerId, peerConn);
    
    // Handle incoming data channel
    peer.ondatachannel = (event) => {
      peerConn.dataChannel = event.channel;
      this.setupDataChannel(fromPeerId, event.channel);
    };
    
    // ICE candidate handling
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignaling({
          type: 'signal',
          from: this.peerId,
          to: fromPeerId,
          room: this.roomName,
          signal: { type: 'ice-candidate', candidate: event.candidate }
        });
      }
    };
    
    await peer.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    
    this.sendSignaling({
      type: 'signal',
      from: this.peerId,
      to: fromPeerId,
      room: this.roomName,
      signal: { type: 'answer', sdp: answer }
    });
  }

  private setupDataChannel(peerId: string, channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    
    channel.onopen = () => {
      console.log(`[StarTopology] Data channel opened with peer ${peerId}`);
      this.syncPeer(peerId);
    };
    
    channel.onmessage = (event) => {
      this.handlePeerMessage(peerId, new Uint8Array(event.data));
    };
    
    channel.onclose = () => {
      console.log(`[StarTopology] Data channel closed with peer ${peerId}`);
      const peerConn = this.peers.get(peerId);
      if (peerConn) {
        peerConn.peer.close();
        this.peers.delete(peerId);
      }
      this.emitPeersChanged();
      
      // If this was the leader, trigger reconnection
      if (peerId === this.leaderId) {
        console.log(`[StarTopology] Lost connection to leader, attempting reconnection...`);
        // Try to reconnect after a short delay in case of temporary network issues
        // If the leader truly left, handlePeerLeave will be called and re-elect
        setTimeout(() => {
          if (!this.peers.has(peerId) && this.knownPeerIds.has(peerId)) {
            this.evaluateConnection(peerId);
          }
        }, 1000);
      }
    };
  }

  private syncPeer(peerId: string) {
    const peerConn = this.peers.get(peerId);
    if (!peerConn?.dataChannel || peerConn.dataChannel.readyState !== 'open') return;
    
    // Send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    peerConn.dataChannel.send(encoding.toUint8Array(encoder));
    
    // Send awareness state
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        this.awareness,
        Array.from(this.awareness.getStates().keys())
      )
    );
    peerConn.dataChannel.send(encoding.toUint8Array(awarenessEncoder));
  }

  private handlePeerMessage(peerId: string, message: Uint8Array) {
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    
    const peerConn = this.peers.get(peerId);
    if (!peerConn) return;
    
    if (messageType === messageSync) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      
      if (syncMessageType === syncProtocol.messageYjsSyncStep2 && !peerConn.synced) {
        peerConn.synced = true;
        this.checkIfFullySynced();
      }
      
      if (encoding.length(encoder) > 1 && peerConn.dataChannel?.readyState === 'open') {
        peerConn.dataChannel.send(encoding.toUint8Array(encoder));
      }
      
      // If we're the leader, broadcast updates to all other peers
      if (this.isLeader && syncMessageType === syncProtocol.messageYjsUpdate) {
        this.broadcastToOthers(peerId, message);
      }
    } else if (messageType === messageAwareness) {
      awarenessProtocol.applyAwarenessUpdate(
        this.awareness,
        decoding.readVarUint8Array(decoder),
        this
      );
      
      // If we're the leader, broadcast awareness to all other peers
      if (this.isLeader) {
        this.broadcastToOthers(peerId, message);
      }
    }
  }

  private broadcastToOthers(excludePeerId: string, message: Uint8Array) {
    this.peers.forEach((peerConn, peerId) => {
      if (peerId !== excludePeerId && peerConn.dataChannel?.readyState === 'open') {
        // Send as Uint8Array
        peerConn.dataChannel.send(new Uint8Array(message));
      }
    });
  }

  private setupDocumentListeners() {
    this.doc.on('update', (update: Uint8Array, origin: any) => {
      // Only broadcast if we're the source or we're the leader
      if (origin !== this && (this.isLeader || this.peers.size === 0)) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, update);
        const message = encoding.toUint8Array(encoder);
        
        this.peers.forEach((peerConn) => {
          if (peerConn.dataChannel?.readyState === 'open') {
            peerConn.dataChannel.send(message);
          }
        });
      }
    });
    
    this.awareness.on('update', ({ added, updated, removed }: any) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      const message = encoding.toUint8Array(encoder);
      
      this.peers.forEach((peerConn) => {
        if (peerConn.dataChannel?.readyState === 'open') {
          peerConn.dataChannel.send(message);
        }
      });
    });
  }

  private checkIfFullySynced() {
    const allSynced = Array.from(this.peers.values()).every(p => p.synced);
    if (allSynced && !this.synced) {
      this.synced = true;
      console.log('[StarTopology] Fully synced with all peers');
      this.emit('synced', true);
    }
  }

  private emitPeersChanged() {
    const connectedPeers = Array.from(this.peers.keys());
    this.emit('peers', {
      added: connectedPeers,
      removed: [],
      webrtcPeers: connectedPeers,
      bcPeers: []
    });
  }

  // Event emitter methods
  on(event: string, handler: Function) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  once(event: string, handler: Function) {
    const wrappedHandler = (...args: any[]) => {
      handler(...args);
      this.off(event, wrappedHandler);
    };
    this.on(event, wrappedHandler);
  }

  off(event: string, handler: Function) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: string, ...args: any[]) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  // Public API
  get connected(): boolean {
    return this.peers.size > 0 || this.knownPeerIds.size === 0;
  }

  get connectedPeers(): string[] {
    return Array.from(this.peers.keys());
  }

  destroy() {
    // Announce we're leaving
    this.sendSignaling({
      type: 'leave',
      from: this.peerId,
      room: this.roomName
    });
    
    // Close all peer connections
    this.peers.forEach(peerConn => {
      peerConn.peer.close();
    });
    this.peers.clear();
    
    // Close signaling connection
    if (this.signalingWs) {
      this.signalingWs.close();
      this.signalingWs = null;
    }
    
    this.awareness.destroy();
  }
}
