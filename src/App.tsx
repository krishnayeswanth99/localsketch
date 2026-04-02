// src/App.tsx
import { useState } from 'react';
import { YjsRoom } from './YjsRoom';
import Canvas from './components/Canvas';

function Room({ name }: { name: string }) {
  // 1. Extract undoManager from the hook
  const { ydoc, isSynced, undoManager } = YjsRoom(name);

  // 2. Wait until BOTH doc and undoManager are ready
  if (!ydoc || !undoManager) {
    return <div>Connecting to Local-First Database...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0 }}>Room: {name}</h2>
          <p style={{ color: isSynced ? 'green' : 'orange', margin: '5px 0' }}>
            Network Status: {isSynced ? 'Connected to Peers' : 'Connecting/Offline...'}
          </p>
        </div>
      </div>
      
      {/* 3. Pass it into the Canvas */}
      <Canvas doc={ydoc} undoManager={undoManager} />
    </div>
  );
}

export default function App() {
  const [roomName, setRoomName] = useState('');
  const [joined, setJoined] = useState(false);

  if (!joined) {
    return (
      <div style={{ maxWidth: '400px', margin: '100px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h1>LocalSketch</h1>
        <p>Enter a room name to join or create a collaborative whiteboard.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (roomName) setJoined(true); }}>
          <input 
            type="text" 
            placeholder="Room Name (e.g. daily-standup)" 
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            style={{ width: '100%', padding: '10px', fontSize: '16px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
          <button 
            type="submit" 
            style={{ width: '100%', padding: '10px', fontSize: '16px', background: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Join / Create Room
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '40px auto', fontFamily: 'sans-serif' }}>
      <button onClick={() => setJoined(false)} style={{ marginBottom: '20px', cursor: 'pointer' }}>
        &larr; Leave Room
      </button>
      <Room name={roomName} />
    </div>
  );
}