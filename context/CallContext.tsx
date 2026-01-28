
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { 
  collection, doc, addDoc, updateDoc, onSnapshot, 
  query, where, serverTimestamp, setDoc, getDoc 
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from './AuthContext';
import { CallSession, CallStatus, CallType } from '../types';
import { WebRTCService } from '../services/WebRTCService';
import { COLLECTIONS } from '../constants';

// Sound Effects (Base64 for offline/instant availability)
const ON_SOUND = "data:audio/wav;base64,UklGRl9vT1BXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"; // Placeholder short beep
const OFF_SOUND = "data:audio/wav;base64,UklGRl9vT1BXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU"; // Placeholder short beep

interface CallContextType {
  activeCall: CallSession | null;
  incomingCall: CallSession | null;
  callStatus: CallStatus;
  makeCall: (calleeId: string, calleeName: string, type: CallType) => Promise<void>;
  answerCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  toggleTalk: (isTalking: boolean) => void;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  playTone: (type: 'ON' | 'OFF') => void;
  ensureAudioContext: () => void;
}

const CallContext = createContext<CallContextType>({} as CallContextType);

export const useCall = () => useContext(CallContext);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [incomingCall, setIncomingCall] = useState<CallSession | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>(CallStatus.ENDED);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  const rtcRef = useRef<WebRTCService | null>(null);
  const callUnsubRef = useRef<(() => void) | null>(null);
  
  // Audio handling
  const audioContextRef = useRef<AudioContext | null>(null);

  const ensureAudioContext = () => {
      if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume();
      }
      // Play silent buffer to unlock audio on iOS/Android WebViews
      const buffer = audioContextRef.current.createBuffer(1, 1, 22050);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.start(0);
  };

  const playTone = (type: 'ON' | 'OFF') => {
      ensureAudioContext();
      const ctx = audioContextRef.current;
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'ON') {
          osc.frequency.setValueAtTime(800, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      } else {
          osc.frequency.setValueAtTime(1200, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
      }

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);

      osc.start();
      osc.stop(ctx.currentTime + 0.15);
  };

  // Initialize WebRTC helper
  useEffect(() => {
    rtcRef.current = new WebRTCService();
    
    rtcRef.current.onRemoteStream((stream) => {
      setRemoteStream(stream);
      // Auto-play remote audio for PTT
      const audio = new Audio();
      audio.srcObject = stream;
      audio.play().catch(e => console.error("Autoplay blocked", e));
    });

    return () => {
      if (rtcRef.current) rtcRef.current.close();
    };
  }, []);

  // Listen for incoming calls
  useEffect(() => {
    if (!user || !db) return;

    const q = query(
      collection(db, COLLECTIONS.CALLS),
      where('calleeId', '==', user.uid),
      where('status', '==', CallStatus.OFFERING)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as CallSession;
          // Only accept if we aren't already in a call
          if (callStatus === CallStatus.ENDED) {
            setIncomingCall(data);
            setCallStatus(CallStatus.RINGING);
          } else {
             // Auto-reject busy
             if (db) {
                updateDoc(doc(db, COLLECTIONS.CALLS, data.callId), { status: 'BUSY' });
             }
          }
        }
      });
    }, (error) => {
        console.error("Error listening for incoming calls:", error);
    });

    return () => unsubscribe();
  }, [user, callStatus]);

  // Auto-Answer PTT Calls
  useEffect(() => {
    if (incomingCall && incomingCall.type === CallType.PTT && callStatus === CallStatus.RINGING) {
        console.log("Auto-answering PTT call from", incomingCall.callerName);
        playTone('ON');
        answerCall();
    }
  }, [incomingCall, callStatus]);

  // Handle Active Call Signaling
  useEffect(() => {
    if (!activeCall || !db || !rtcRef.current) return;

    const callDocRef = doc(db, COLLECTIONS.CALLS, activeCall.callId);

    // Listen to call document changes (Answer, End, Hangup, Active Speaker)
    const unsub = onSnapshot(callDocRef, async (snapshot) => {
        const data = snapshot.data();
        if (!data) return;

        // Remote user answered
        if (data.status === CallStatus.CONNECTED && callStatus === CallStatus.OFFERING) {
            setCallStatus(CallStatus.CONNECTED);
            if (activeCall.type === CallType.PTT) {
               playTone('ON');
            }
        }

        // Handle Active Speaker visual state
        if (data.activeSpeakerId !== undefined) {
             setActiveCall(prev => prev ? ({ ...prev, activeSpeakerId: data.activeSpeakerId }) : null);
        }

        // Remote user ended call
        if (data.status === CallStatus.ENDED || data.status === CallStatus.REJECTED || data.status === 'BUSY') {
             if (activeCall.type === CallType.PTT && callStatus === CallStatus.CONNECTED) playTone('OFF');
             cleanupCall();
        }
    });

    // Listen for remote answers (SDP)
    const answerUnsub = onSnapshot(collection(callDocRef, 'answerCandidates'), (snapshot) => {
       snapshot.docChanges().forEach((change) => {
           if (change.type === 'added') {
             const data = change.doc.data();
             rtcRef.current?.addIceCandidate(data as RTCIceCandidateInit);
           }
       });
    });
    
    // Check for answer SDP if I am the caller
    if (activeCall.callerId === user?.uid) {
         getDoc(callDocRef).then(async (snap) => {
             const data = snap.data();
             if (snap.exists() && data?.answer) {
                 await rtcRef.current?.addAnswer(data.answer);
             }
         });
         
         // Realtime listener for answer SDP field
         const sdpUnsub = onSnapshot(callDocRef, async (snap) => {
            const d = snap.data();
            if (d?.answer && !rtcRef.current?.peerConnection?.currentRemoteDescription) {
                await rtcRef.current?.addAnswer(d.answer);
            }
         });
         callUnsubRef.current = () => { unsub(); answerUnsub(); sdpUnsub(); };
    } else {
         callUnsubRef.current = () => { unsub(); answerUnsub(); };
    }
    
    return () => {
        if(callUnsubRef.current) callUnsubRef.current();
    }
  }, [activeCall, user, callStatus]);

  const makeCall = async (calleeId: string, calleeName: string, type: CallType) => {
    if (!user || !db || !rtcRef.current) return;

    ensureAudioContext();

    // 1. Get Local Stream
    const stream = await rtcRef.current.startLocalStream(type === CallType.VIDEO);
    setLocalStream(stream);

    // CRITICAL: Mute immediately for PTT. We start "On Air" but silent.
    if (type === CallType.PTT) {
       rtcRef.current.toggleAudio(false);
    } else {
       playTone('ON'); // Ringing sound for other calls
    }

    // 2. Create Offer
    const offer = await rtcRef.current.createOffer();

    // 3. Create Call Document
    const callDocRef = doc(collection(db, COLLECTIONS.CALLS));
    const callId = callDocRef.id;
    
    const safeUserPhoto = user.photoURL || null;

    const callData: CallSession = {
      callId,
      callerId: user.uid,
      callerName: user.displayName || 'Unknown',
      callerPhoto: safeUserPhoto as any, 
      calleeId,
      calleeName,
      type,
      status: CallStatus.OFFERING,
      startedAt: Date.now(),
      activeSpeakerId: null,
    };

    const firestoreData = {
        ...callData,
        offer: { type: offer.type, sdp: offer.sdp }
    };

    await setDoc(callDocRef, firestoreData);

    rtcRef.current.onIceCandidate(async (candidate) => {
        if (db) {
            await addDoc(collection(db, COLLECTIONS.CALLS, callId, 'offerCandidates'), candidate.toJSON());
        }
    });

    setActiveCall(callData);
    setCallStatus(CallStatus.OFFERING);
  };

  const answerCall = async () => {
    if (!incomingCall || !user || !db || !rtcRef.current) return;

    ensureAudioContext();

    // 1. Get Local Stream
    const stream = await rtcRef.current.startLocalStream(incomingCall.type === CallType.VIDEO);
    setLocalStream(stream);

    // CRITICAL: Mute immediately for PTT answer
    if (incomingCall.type === CallType.PTT) {
        rtcRef.current.toggleAudio(false);
    }

    // 2. Get the Offer from DB
    const callDocRef = doc(db, COLLECTIONS.CALLS, incomingCall.callId);
    const callDoc = await getDoc(callDocRef);
    const callData = callDoc.data();
    
    if (callData && callData.offer) {
        await rtcRef.current.peerConnection?.setRemoteDescription(new RTCSessionDescription(callData.offer));
        const answer = await rtcRef.current.createAnswer(callData.offer);
        
        await updateDoc(callDocRef, {
            status: CallStatus.CONNECTED,
            answer: { type: answer.type, sdp: answer.sdp }
        });

        rtcRef.current.onIceCandidate(async (candidate) => {
            if (db) {
                await addDoc(collection(db, COLLECTIONS.CALLS, incomingCall.callId, 'answerCandidates'), candidate.toJSON());
            }
        });
        
        onSnapshot(collection(db, COLLECTIONS.CALLS, incomingCall.callId, 'offerCandidates'), (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if(change.type === 'added') {
                    rtcRef.current?.addIceCandidate(change.doc.data() as RTCIceCandidateInit);
                }
            })
        });

        setActiveCall(incomingCall);
        setIncomingCall(null);
        setCallStatus(CallStatus.CONNECTED);
    }
  };

  // Toggle PTT Transmission
  const toggleTalk = async (isTalking: boolean) => {
      if (!rtcRef.current || !activeCall || !db || !user) return;
      
      // 1. Audio Control (Instant)
      rtcRef.current.toggleAudio(isTalking);

      // 2. Visual Signaling (Firestore Latency ~500ms but persistent)
      // Only update if state actually changes to save writes
      try {
          const callRef = doc(db, COLLECTIONS.CALLS, activeCall.callId);
          await updateDoc(callRef, {
              activeSpeakerId: isTalking ? user.uid : null
          });
      } catch (e) {
          console.error("Error signaling talk state", e);
      }
  };

  const cleanupCall = () => {
    setCallStatus(CallStatus.ENDED);
    setActiveCall(null);
    setIncomingCall(null);
    setRemoteStream(null);
    setLocalStream(null);
    // Re-init WebRTC service for next call
    rtcRef.current?.close();
    rtcRef.current = new WebRTCService();
    rtcRef.current.onRemoteStream((stream) => {
        setRemoteStream(stream);
        // Ensure auto-play logic persists across resets
        if(stream) {
            const audio = new Audio();
            audio.srcObject = stream;
            audio.play().catch(console.error);
        }
    });
  };

  const endCall = async () => {
    if (activeCall?.type === CallType.PTT) playTone('OFF');
    
    if (activeCall && db) {
        const duration = Math.floor((Date.now() - activeCall.startedAt) / 1000);
        await updateDoc(doc(db, COLLECTIONS.CALLS, activeCall.callId), {
            status: CallStatus.ENDED,
            endedAt: Date.now(),
            duration: duration
        });
    }
    cleanupCall();
  };

  const rejectCall = async () => {
      if (incomingCall && db) {
        await updateDoc(doc(db, COLLECTIONS.CALLS, incomingCall.callId), {
            status: CallStatus.REJECTED,
            endedAt: Date.now(),
            duration: 0
        });
      }
      setIncomingCall(null);
      setCallStatus(CallStatus.ENDED);
  }

  return (
    <CallContext.Provider value={{
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
      ensureAudioContext
    }}>
      {children}
    </CallContext.Provider>
  );
};
