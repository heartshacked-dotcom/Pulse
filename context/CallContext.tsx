
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  setDoc,
  getDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { useAuth } from "./AuthContext";
import { CallSession, CallStatus, CallType } from "../types";
import { WebRTCService } from "../services/WebRTCService";
import { COLLECTIONS } from "../constants";

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
  const callUnsubRef = useRef<(() => void) | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

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

  useEffect(() => {
    if (!user || !db) return;
    const q = query(
      collection(db, COLLECTIONS.CALLS),
      where("calleeId", "==", user.uid),
      where("status", "==", CallStatus.OFFERING),
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "added") {
          const data = change.doc.data() as CallSession;
          if (statusRef.current === CallStatus.ENDED) {
            setIncomingCall(data);
            setCallStatus(CallStatus.RINGING);
          } else if (data.callId !== activeCallRef.current?.callId) {
            await updateDoc(doc(db, COLLECTIONS.CALLS, data.callId), {
              status: "BUSY",
            });
          }
        }
      });
    });
    return () => unsubscribe();
  }, [user?.uid]);

  useEffect(() => {
    if (!activeCall || !db || !user) return;
    const callDocRef = doc(db, COLLECTIONS.CALLS, activeCall.callId);

    const unsubStatus = onSnapshot(callDocRef, async (snapshot) => {
      const data = snapshot.data();
      if (!data) return;

      if (data.status === CallStatus.CONNECTED && statusRef.current !== CallStatus.CONNECTED) {
        setCallStatus(CallStatus.CONNECTED);
        playTone("ON");
      }

      if (data.activeSpeakerId !== undefined) {
        setActiveCall((prev) =>
          prev ? { ...prev, activeSpeakerId: data.activeSpeakerId } : null,
        );
      }

      if (["ENDED", "REJECTED", "BUSY"].includes(data.status)) {
        cleanupCall();
      }
    });

    callUnsubRef.current = () => unsubStatus();
    return () => { if (callUnsubRef.current) callUnsubRef.current(); };
  }, [activeCall?.callId, user?.uid]);

  const makeCall = async (calleeId: string, calleeName: string) => {
    if (!user || !db || !rtcRef.current || statusRef.current !== CallStatus.ENDED) return;
    ensureAudioContext();

    try {
      const stream = await rtcRef.current.setupLocalMedia();
      setLocalStream(stream);

      // Mute audio by default for PTT
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
    }
  };

  const answerCall = async () => {
    if (!incomingCall || !user || !db || !rtcRef.current) return;
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
    if (!activeCall || !db || !user || !localStream) return;
    ensureAudioContext();

    localStream.getAudioTracks().forEach((track) => {
      track.enabled = isTalking;
    });

    if (remoteAudioRef.current && remoteAudioRef.current.srcObject) {
      remoteAudioRef.current.play().catch(() => {});
    }

    try {
      await updateDoc(doc(db, COLLECTIONS.CALLS, activeCall.callId), {
        activeSpeakerId: isTalking ? user.uid : null,
      });
    } catch (e) {
      console.error("Toggle talk update error:", e);
    }
  };

  const cleanupCall = () => {
    setCallStatus(CallStatus.ENDED);
    setActiveCall(null);
    setIncomingCall(null);
    setRemoteStream(null);
    setLocalStream(null);

    if (callUnsubRef.current) {
      callUnsubRef.current();
      callUnsubRef.current = null;
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
    if (activeCall && db) {
      await updateDoc(doc(db, COLLECTIONS.CALLS, activeCall.callId), {
        status: CallStatus.ENDED,
        endedAt: Date.now(),
      }).catch(() => {});
    }
    cleanupCall();
  };

  const rejectCall = async () => {
    if (incomingCall && db) {
      await updateDoc(doc(db, COLLECTIONS.CALLS, incomingCall.callId), {
        status: "REJECTED",
      }).catch(() => {});
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
