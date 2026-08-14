import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useSocket } from '../context/SocketContext.jsx';
import sfx from '../utils/soundEffects.js';

export default function Lobby() {
  const {
    connected,
    roomId,
    room,
    playerId,
    createRoom,
    joinRoom,
    configureRoom,
    startGame,
    leaveRoom,
    addToast,
  } = useSocket();

  const [name, setName] = useState(() => localStorage.getItem('liarsuno-name') || '');
  const [handSize, setHandSize] = useState(7);
  const [joinCode, setJoinCode] = useState('');
  const [tab, setTab] = useState('create');
  const [busy, setBusy] = useState(false);

  const isHost = room && room.hostId === playerId;
  const myPlayer = room?.players?.find((p) => p.id === playerId);

  const shareUrl = useMemo(() => {
    if (!roomId) return '';
    return `${window.location.origin}${window.location.pathname}#join=${roomId}`;
  }, [roomId]);

  const saveName = () => {
    if (name.trim()) localStorage.setItem('liarsuno-name', name.trim());
  };

  const handleCreate = async () => {
    saveName();
    setBusy(true);
    const res = await createRoom({ playerName: name, startingHandSize: handSize });
    setBusy(false);
    if (!res.ok) addToast(res.error || 'Failed to create room', 'danger');
  };

  const handleJoin = async () => {
    saveName();
    setBusy(true);
    const res = await joinRoom({ roomId: joinCode, playerName: name });
    setBusy(false);
    if (!res.ok) addToast(res.error || 'Failed to join room', 'danger');
  };

  const handleStart = async () => {
    const res = await startGame();
    if (!res.ok) addToast(res.error || 'Cannot start', 'danger');
  };

  const handleHandSize = async (v) => {
    setHandSize(v);
    if (room) {
      const res = await configureRoom(v);
      if (!res.ok) addToast(res.error, 'danger');
    }
  };

  const copyCode = async () => {
    const text = `${shareUrl}  (code: ${roomId})`;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error('clipboard-api-unavailable');
      }
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } finally {
        document.body.removeChild(ta);
      }
      if (!ok) throw new Error('copy failed');
    }
    addToast('Invite link copied!', 'success');
  };

  const joinFromHash = useMemo(() => {
    const m = window.location.hash.match(/#join=(\w{6})/);
    return m ? m[1].toUpperCase() : null;
  }, []);

  return (
    <div className="table-felt" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'auto' }}>
      {!room ? (
        <motion.div
          className="panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ maxWidth: 420, width: '100%', padding: 28 }}
        >
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div style={{ fontSize: 44 }}>🃏</div>
            <h1 className="panel-title" style={{ fontSize: 26, margin: '8px 0 4px' }}>Liar's UNO</h1>
            <p style={{ color: 'var(--text-mid)', fontSize: 13, margin: 0 }}>
              Bluff the table. Call the liar. 2–7 players.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['create', 'join'].map((t) => (
              <button
                key={t}
                className="btn-ghost"
                style={{ flex: 1, background: tab === t ? 'rgba(255,255,255,0.12)' : 'transparent' }}
                onClick={() => { setTab(t); sfx.click(); }}
              >
                {t === 'create' ? 'Create room' : 'Join room'}
              </button>
            ))}
          </div>

          <label className="panel-title" style={{ display: 'block', fontSize: 12, color: 'var(--text-mid)', marginBottom: 6 }}>
            Your name
          </label>
          <input
            className="input-dark"
            placeholder="e.g. BluffKing"
            value={name}
            maxLength={16}
            onChange={(e) => setName(e.target.value)}
          />

          {tab === 'create' && (
            <>
              <label className="panel-title" style={{ display: 'block', fontSize: 12, color: 'var(--text-mid)', margin: '14px 0 6px' }}>
                Starting hand size
              </label>
              <div className="range-wrap">
                <input
                  type="range"
                  min={1}
                  max={15}
                  step={1}
                  value={handSize}
                  className="range-slider"
                  onChange={(e) => setHandSize(Number(e.target.value))}
                />
                <span className="range-value">{handSize} cards</span>
              </div>
              <div className="range-limits">
                <span>1</span>
                <span>15</span>
              </div>
            </>
          )}

          {tab === 'join' && (
            <>
              <label className="panel-title" style={{ display: 'block', fontSize: 12, color: 'var(--text-mid)', margin: '14px 0 6px' }}>
                Room code
              </label>
              <input
                className="input-dark"
                placeholder="ABC123"
                value={joinCode}
                maxLength={6}
                style={{ textTransform: 'uppercase', letterSpacing: '0.3em', fontWeight: 800 }}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
            </>
          )}

          {!connected && (
            <p style={{ color: 'var(--uno-yellow)', fontSize: 12, margin: '10px 0 0' }}>
              Connecting to server…
            </p>
          )}

          <button
            className="btn-primary btn-accent"
            style={{ width: '100%', marginTop: 18, fontSize: 15 }}
            disabled={busy || !connected || !name.trim() || (tab === 'join' && joinCode.length < 6)}
            onClick={tab === 'create' ? handleCreate : handleJoin}
          >
            {tab === 'create' ? 'Create room' : 'Join room'}
          </button>
        </motion.div>
      ) : (
        <motion.div
          className="panel"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ maxWidth: 520, width: '100%', padding: 28 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h2 className="panel-title" style={{ fontSize: 22, margin: 0 }}>Room {roomId}</h2>
            <button className="btn-ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={async () => { sfx.click(); await leaveRoom(); }}>
              Leave
            </button>
          </div>
          <p style={{ color: 'var(--text-mid)', fontSize: 13, margin: '0 0 14px' }}>
            Share this code with friends to join.
          </p>

          <div style={{ marginBottom: 18 }}>
            <div
              onDoubleClick={copyCode}
              title="Double-click to copy"
              style={{
                background: 'rgba(9,14,32,0.8)',
                border: '1px dashed var(--uno-blue)',
                borderRadius: 12,
                padding: '14px',
                textAlign: 'center',
                fontSize: 30,
                fontWeight: 900,
                letterSpacing: '0.35em',
                color: 'var(--uno-blue)',
                textShadow: '0 0 18px rgba(0,187,249,0.5)',
                cursor: 'copy',
                userSelect: 'all',
                WebkitUserSelect: 'all',
              }}
            >
              {roomId}
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: 12, margin: '8px 0 0', textAlign: 'center' }}>
              Double-click the code to copy it
            </p>
          </div>

          <div className="panel-title" style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 8 }}>
            Players ({room.players.length}/7)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
            {room.players.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontSize: 14,
                  opacity: p.isConnected ? 1 : 0.5,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'linear-gradient(145deg,#2a3f8f,#16224a)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  {(p.name || '?').charAt(0).toUpperCase()}
                </div>
                <span style={{ fontWeight: 700, flex: 1 }}>
                  {p.name}
                  {p.id === playerId && <em style={{ color: 'var(--text-dim)', fontStyle: 'normal' }}> (you)</em>}
                </span>
                {p.isHost && <span className="hud-chip">Host</span>}
                {!p.isConnected && <span className="hud-chip" style={{ color: 'var(--uno-red)' }}>Offline</span>}
              </div>
            ))}
          </div>

          {isHost ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                <span className="panel-title" style={{ fontSize: 12, color: 'var(--text-mid)', whiteSpace: 'nowrap' }}>Hand size</span>
                <input
                  type="range"
                  min={1}
                  max={room.maxStartingHandSize}
                  step={1}
                  value={Math.min(room.startingHandSize, room.maxStartingHandSize)}
                  className="range-slider"
                  onChange={(e) => handleHandSize(Number(e.target.value))}
                />
                <span className="range-value">{room.startingHandSize}</span>
              </div>
              <div className="range-limits" style={{ margin: '-10px 0 16px' }}>
                <span>1</span>
                <span>max {room.maxStartingHandSize}</span>
              </div>
              <button
                className="btn-primary btn-accent"
                style={{ width: '100%', fontSize: 15 }}
                disabled={room.players.filter((p) => p.isConnected).length < 2}
                onClick={handleStart}
              >
                Start game ({room.players.filter((p) => p.isConnected).length} ready)
              </button>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-mid)', fontSize: 13 }}>
              Waiting for the host to start the game…
              {joinFromHash && <div style={{ marginTop: 4 }}>Joined via invite link ✓</div>}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}