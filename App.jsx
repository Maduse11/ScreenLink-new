import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";

const SERVER_URL = import.meta.env.VITE_SIGNALING_URL || window.location.origin;
const isSecure = window.isSecureContext || ["localhost", "127.0.0.1"].includes(location.hostname);

function detectSupport() {
  const media = navigator.mediaDevices;
  const hasCapture = !!media?.getDisplayMedia;
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod/i.test(ua);
  return { hasCapture, mobile, secure: isSecure };
}

export default function App() {
  const [mode, setMode] = useState("home");
  const [status, setStatus] = useState("Pronto para conectar");
  const [code, setCode] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [support] = useState(detectSupport);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef(null);
  const peerRef = useRef(null);
  const streamRef = useRef(null);
  const videoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const codeRef = useRef("");

  const getSocket = () => {
    if (!socketRef.current) {
      socketRef.current = io(SERVER_URL, { transports: ["websocket", "polling"] });
    }
    return socketRef.current;
  };

  const closeMedia = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setConnected(false);
  };

  const endSession = () => {
    if (codeRef.current) socketRef.current?.emit("end-session", { code: codeRef.current });
    closeMedia();
    setCode("");
    codeRef.current = "";
    setStatus("Transmissão encerrada");
    setMode("home");
  };

  const makePeer = (sessionCode, isSender) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    peerRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        getSocket().emit("signal", { code: sessionCode, data: { candidate: event.candidate } });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setConnected(true);
        setStatus("Dispositivos conectados");
      } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
        setConnected(false);
      }
    };

    if (!isSender) {
      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch(() => {});
        }
      };
    }
    return pc;
  };

  const startSender = async () => {
    setError("");
    if (!support.secure) {
      setError("Por segurança, a transmissão exige HTTPS (ou localhost durante testes).");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Este navegador não oferece captura de tela. Tente um navegador compatível em um computador.");
      return;
    }
    try {
      setStatus("Aguardando permissão para compartilhar...");
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: audioEnabled
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      const socket = getSocket();
      socket.emit("create-session", async (result) => {
        if (!result?.ok) {
          setError("Não foi possível criar a conexão.");
          closeMedia();
          return;
        }
        setCode(result.code);
        codeRef.current = result.code;
        setMode("sender");
        setStatus("Aguardando o outro dispositivo...");
        const pc = makePeer(result.code, true);
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
        stream.getVideoTracks()[0].addEventListener("ended", endSession, { once: true });
        socket.off("peer-joined");
        socket.on("peer-joined", async () => {
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit("signal", { code: result.code, data: { description: pc.localDescription } });
          } catch {
            setError("Não foi possível iniciar a transmissão.");
          }
        });
      });
    } catch (err) {
      setStatus("Compartilhamento não iniciado");
      if (err.name !== "NotAllowedError") setError("Não foi possível iniciar o compartilhamento: " + err.message);
    }
  };

  const joinSession = () => {
    setError("");
    const clean = enteredCode.replace(/\D/g, "").slice(0, 6);
    if (clean.length !== 6) {
      setError("Digite o código de 6 números.");
      return;
    }
    const socket = getSocket();
    socket.emit("join-session", { code: clean }, (result) => {
      if (!result?.ok) {
        setError(result?.error || "Não foi possível entrar na sessão.");
        return;
      }
      setCode(clean);
      codeRef.current = clean;
      setMode("receiver");
      setStatus("Conectando ao dispositivo...");
      const pc = makePeer(clean, false);
      socket.off("signal");
      socket.on("signal", async (data) => {
        try {
          if (data?.description) {
            await pc.setRemoteDescription(data.description);
            if (data.description.type === "offer") {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit("signal", { code: clean, data: { description: pc.localDescription } });
            }
          } else if (data?.candidate) {
            await pc.addIceCandidate(data.candidate);
          }
        } catch {
          setError("Falha ao negociar a conexão. Tente gerar outro código.");
        }
      });
    });
  };

  useEffect(() => {
    const socket = getSocket();
    const onSignal = async (data) => {
      const pc = peerRef.current;
      if (!pc) return;
      try {
        if (data?.description) {
          await pc.setRemoteDescription(data.description);
          if (data.description.type === "answer") setStatus("Finalizando conexão...");
        } else if (data?.candidate) {
          await pc.addIceCandidate(data.candidate);
        }
      } catch {
        setError("Não foi possível estabelecer a conexão.");
      }
    };
    socket.on("signal", onSignal);
    socket.on("session-ended", () => {
      closeMedia();
      setCode("");
      codeRef.current = "";
      setStatus("A sessão foi encerrada");
      setMode("home");
    });
    return () => {
      socket.off("signal", onSignal);
    };
  }, []);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    peerRef.current?.close();
    socketRef.current?.disconnect();
  }, []);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Não foi possível copiar. Selecione o código manualmente.");
    }
  };

  const shareUrl = `${window.location.origin}/?join=${code}`;
  useEffect(() => {
    const join = new URLSearchParams(location.search).get("join");
    if (join) setEnteredCode(join.replace(/\D/g, "").slice(0, 6));
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={e => { e.preventDefault(); endSession(); }}>
          <span className="brand-mark"><i className="icon-screen" /></span>
          <span>Screen<span>Link</span></span>
        </a>
        <div className="secure-label"><span className="pulse" /> Conexão privada</div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span className="eyebrow-line" /> COMPARTILHAMENTO SIMPLES E SEGURO</div>
        <h1>Sua tela, em outro<br /><span>dispositivo.</span></h1>
        <p className="hero-copy">Conecte seu celular ou computador e compartilhe sua tela em tempo real, diretamente pelo navegador.</p>

        {mode === "home" && (
          <div className="choice-grid">
            <button className="choice-card primary-card" onClick={startSender}>
              <span className="card-icon"><i className="icon-send" /></span>
              <span className="card-title">Compartilhar tela</span>
              <span className="card-desc">Envie a tela deste dispositivo para outro aparelho.</span>
              <span className="card-action">Começar a compartilhar <b>↗</b></span>
            </button>
            <div className="choice-card receive-card">
              <span className="card-icon"><i className="icon-monitor" /></span>
              <span className="card-title">Receber tela</span>
              <span className="card-desc">Digite o código exibido no dispositivo que está compartilhando.</span>
              <label className="input-label" htmlFor="session-code">CÓDIGO DE CONEXÃO</label>
              <div className="code-entry">
                <input id="session-code" inputMode="numeric" maxLength="6" placeholder="000 000" value={enteredCode} onChange={e => setEnteredCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
                <button onClick={joinSession} aria-label="Conectar">→</button>
              </div>
            </div>
          </div>
        )}

        {mode === "sender" && (
          <div className="session-panel">
            <div className="session-head"><div><span className="status-dot" /> <b>{status}</b></div><span className="tiny-tag">AGUARDANDO CONEXÃO</span></div>
            <div className="session-content">
              <div className="qr-wrap"><QRCodeSVG value={shareUrl} size={156} bgColor="#ffffff" fgColor="#101827" /></div>
              <div className="session-info">
                <span className="input-label">SEU CÓDIGO DE CONEXÃO</span>
                <div className="big-code">{code}</div>
                <button className="outline-button" onClick={copyCode}>{copied ? "Código copiado ✓" : "Copiar código"}</button>
                <p>Abra o ScreenLink no outro dispositivo e informe este código ou leia o QR Code.</p>
              </div>
            </div>
            <video className="local-preview" ref={videoRef} autoPlay muted playsInline />
            <button className="danger-button" onClick={endSession}>Encerrar compartilhamento</button>
          </div>
        )}

        {mode === "receiver" && (
          <div className="session-panel">
            <div className="session-head"><div><span className="status-dot" /> <b>{status}</b></div><span className="tiny-tag">SESSÃO {code}</span></div>
            <video className="remote-screen" ref={remoteVideoRef} autoPlay playsInline controls />
            <div className="receiver-actions">
              <span className="muted-text">O áudio estará disponível se o navegador de origem permitir.</span>
              <button className="danger-button" onClick={endSession}>Desconectar</button>
            </div>
          </div>
        )}

        {error && <div className="error-box" role="alert">⚠ {error}</div>}
        <div className="trust-row">
          <div><span className="trust-icon">⌁</span><span>Sem gravação automática</span></div>
          <div><span className="trust-icon">♢</span><span>Conexão criptografada pelo WebRTC</span></div>
          <div><span className="trust-icon">◷</span><span>Códigos temporários</span></div>
        </div>
      </section>

      <section className="compat-card">
        <div className="compat-icon">✳</div>
        <div>
          <b>Verificação automática do navegador</b>
          <p>{support.hasCapture ? "Este navegador disponibiliza a API de captura de tela. A permissão será solicitada quando você iniciar." : "Este navegador não disponibiliza a captura de tela para este site. Em celulares, isso pode ser uma limitação do navegador ou do sistema."}</p>
          {!support.secure && <p className="warning-text">Atenção: HTTPS é obrigatório para compartilhar a tela fora do localhost.</p>}
        </div>
        <span className={`compat-status ${support.hasCapture && support.secure ? "available" : "limited"}`}>{support.hasCapture && support.secure ? "API disponível" : "Limitado"}</span>
      </section>

      <footer>
        <span>© {new Date().getFullYear()} ScreenLink</span>
        <span>Compartilhamento com autorização. Sua privacidade importa.</span>
      </footer>
    </main>
  );
}