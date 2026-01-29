
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import {
  ref,
  query,
  orderByChild,
  equalTo,
  onValue,
  update,
  off,
  get
} from "firebase/database";
import { db, rtdb } from "../services/firebase";
import { useAuth } from "./AuthContext";
import { CallSession, CallStatus, CallType } from "../types";
import { WebRTCService } from "../services/WebRTCService";

interface CallContextType {
  activeCall: CallSession | null;
  incomingCall: CallSession | null;
  callStatus: CallStatus;
  makeCall: (
    calleeId: string,
    calleeName: string,
  ) => Promise<void>;
  answerCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleTalk: (isTalking: boolean) => void;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  playTone: (type: "ON" | "OFF") => void;
  ensureAudioContext: () => void;
  remoteAudioRef: React.RefObject<HTMLAudioElement>;
}

const CallContext = createContext<CallContextType>({} as CallContextType);

export const useCall = () => useContext(CallContext);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSession | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.ENDED);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const rtcRef = useRef<WebRTCService | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // RTDB Listener references for cleanup
  const incomingListenerRef = useRef<{ ref: any, cb: any } | null>(null);
  const activeCallListenerRef = useRef<{ ref: any, cb: any } | null>(null);

  const statusRef = useRef<CallStatus>(CallStatus.ENDED);
  const activeCallRef = useRef<CallSession | null>(null);

  useEffect(() => {
    statusRef.current = callStatus;
  }, [callStatus]);
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    const initRTC = () => {
      rtcRef.current = new WebRTCService();
      rtcRef.current.createPeerConnection((stream) => {
        setRemoteStream(stream);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          ensureAudioContext();
          setTimeout(() => {
             if (remoteAudioRef.current) remoteAudioRef.current.play().catch(() => {});
          }, 200);
        }
      });
    };
    initRTC();
    return () => {
      if (rtcRef.current) {
        rtcRef.current.cleanup(null);
      }
    };
  }, []);

  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (
          window.AudioContext || (window as any).webkitAudioContext
        )();
      } catch (e) {
        console.error("Failed to create AudioContext:", e);
        return;
      }
    }

    const ctx = audioContextRef.current;
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(err => console.error("AudioContext resume failed:", err));
    }
  };

  const playTone = (type: "ON" | "OFF") => {
    ensureAudioContext();
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(type === "ON" ? 600 : 400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      type === "ON" ? 900 : 300,
      ctx.currentTime + 0.1,
    );
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  };

  // LISTEN FOR INCOMING CALLS (RTDB)
  useEffect(() => {
    if (!user || !rtdb) return;
    
    // Query calls where calleeId == user.uid
    // Note: This requires indexing on 'calleeId' in Firebase Rules for efficiency,
    // but works in dev without it (with warnings).
    const callsRef = query(
        ref(rtdb, 'calls'), 
        orderByChild('calleeId'), 
        equalTo(user.uid)
    );

    const cb = onValue(callsRef, (snapshot) => {
       const calls = snapshot.val();
       if (!calls) return;

       Object.values(calls).forEach((data: any) => {
          if (data.status === 'OFFERING') {
             // Found an incoming call
             if (statusRef.current === CallStatus.ENDED) {
                setIncomingCall(data as CallSession);
                setCallStatus(CallStatus.RINGING);
             } else if (data.callId !== activeCallRef.current?.callId) {
                // Busy - reject implicitly or explicitly
                // For now, we ignore
             }
          }
       });
    });

    incomingListenerRef.current = { ref: callsRef, cb };

    return () => {
       off(callsRef, 'value', cb);
    };
  }, [user?.uid]);

  // MONITOR ACTIVE CALL (RTDB)
  useEffect(() => {
    if (!activeCall || !rtdb) return;
    const callRef = ref(rtdb, `calls/${activeCall.callId}`);

    const cb = onValue(callRef, (snapshot) => {
      const data = snapshot.val();
      
      // If data is null, the call was deleted (ended)
      if (!data) {
        cleanupCall();
        return;
      }

      if (data.status === 'CONNECTED' && statusRef.current !== CallStatus.CONNECTED) {
        setCallStatus(CallStatus.CONNECTED);
        playTone("ON");
      }

      if (data.activeSpeakerId !== undefined) {
        setActiveCall((prev) =>
          prev ? { ...prev, activeSpeakerId: data.activeSpeakerId } : null,
        );
      }

      if (["ENDED", "REJECTED"].includes(data.status)) {
        cleanupCall();
      }
    });

    activeCallListenerRef.current = { ref: callRef, cb };
    return () => { off(callRef, 'value', cb); };
  }, [activeCall?.callId]);

  const makeCall = async (calleeId: string, calleeName: string) => {
    if (!user || !rtdb || !rtcRef.current) return;
    
    if (statusRef.current !== CallStatus.ENDED) return;
    ensureAudioContext();

    try {
      const stream = await rtcRef.current.setupLocalMedia();
      setLocalStream(stream);
      stream.getAudioTracks().forEach((track) => (track.enabled = false));

      rtcRef.current.createPeerConnection((remoteStream) => {
        setRemoteStream(remoteStream);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(() => {});
        }
      });

      const callId = await rtcRef.current.createCall(
        user.uid,
        calleeId,
        {
          callerName: user.displayName || "Unknown",
          callerPhoto: user.photoURL || null,
          calleeName,
        },
      );

      const callData: CallSession = {
        callId,
        callerId: user.uid,
        callerName: user.displayName || "Unknown",
        callerPhoto: user.photoURL || null,
        calleeId,
        calleeName,
        type: CallType.PTT,
        status: CallStatus.OFFERING,
        startedAt: Date.now(),
        activeSpeakerId: null,
      };

      setActiveCall(callData);
      setCallStatus(CallStatus.OFFERING);
    } catch (e) {
      console.error("Error making walkie call:", e);
      cleanupCall();
      throw e;
    }
  };

  const answerCall = async () => {
    if (!incomingCall || !user || !rtdb || !rtcRef.current) return;
    ensureAudioContext();

    try {
      const stream = await rtcRef.current.setupLocalMedia();
      setLocalStream(stream);
      stream.getAudioTracks().forEach((track) => (track.enabled = false));

      rtcRef.current.createPeerConnection((remoteStream) => {
        setRemoteStream(remoteStream);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(() => {});
        }
      });

      await rtcRef.current.answerCall(incomingCall.callId);

      setActiveCall(incomingCall);
      setIncomingCall(null);
      setCallStatus(CallStatus.CONNECTED);
    } catch (e) {
      console.error("Error answering walkie call:", e);
      cleanupCall();
    }
  };

  const toggleTalk = async (isTalking: boolean) => {
    if (!activeCall || !rtdb || !user || !localStream) return;
    ensureAudioContext();

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = isTalking;
    });

    if (remoteAudioRef.current && remoteAudioRef.current.srcObject) {
      remoteAudioRef.current.play().catch(() => {});
    }

    try {
      // Direct RTDB update for low latency PTT
      const callRef = ref(rtdb, `calls/${activeCall.callId}`);
      await update(callRef, {
        activeSpeakerId: isTalking ? user.uid : null,
      });
    } catch (e) {
      console.error("Toggle talk update error:", e);
    }
  };

  const cleanupCall = () => {
    statusRef.current = CallStatus.ENDED;
    activeCallRef.current = null;

    setCallStatus(CallStatus.ENDED);
    setActiveCall(null);
    setIncomingCall(null);
    setRemoteStream(null);
    setLocalStream(null);

    if (activeCallListenerRef.current) {
       off(activeCallListenerRef.current.ref, 'value', activeCallListenerRef.current.cb);
       activeCallListenerRef.current = null;
    }

    if (rtcRef.current) {
      rtcRef.current.cleanup(activeCall?.callId || null);
      
      rtcRef.current = new WebRTCService();
      rtcRef.current.createPeerConnection((stream) => {
        setRemoteStream(stream);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
        }
      });
    }
  };

  const endCall = async () => {
    if (activeCall && rtdb) {
      // Mark as ended in RTDB. WebRTCService cleanup handles archiving.
      const callRef = ref(rtdb, `calls/${activeCall.callId}`);
      try {
        await update(callRef, { status: "ENDED" });
      } catch (e) {}
    }
    cleanupCall();
  };

  const rejectCall = async () => {
    if (incomingCall && rtdb) {
      const callRef = ref(rtdb, `calls/${incomingCall.callId}`);
      try {
        await update(callRef, { status: "REJECTED" });
      } catch (e) {}
    }
    setIncomingCall(null);
    setCallStatus(CallStatus.ENDED);
  };

  return (
    <CallContext.Provider
      value={{
        activeCall,
        incomingCall,
        callStatus,
        makeCall,
        answerCall,
        rejectCall,
        endCall,
        toggleTalk,
        remoteStream,
        localStream,
        playTone,
        ensureAudioContext,
        remoteAudioRef,
      }}
    >
      {children}
    </CallContext.Provider>
  );
};
