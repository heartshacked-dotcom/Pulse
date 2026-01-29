
import { rtdb, db } from "./firebase";
import {
  ref,
  set,
  push,
  onValue,
  update,
  get,
  child,
  remove,
  off,
  DataSnapshot
} from "firebase/database";
import { doc, setDoc, collection } from "firebase/firestore";

const servers = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
        "stun:stun3.l.google.com:19302",
        "stun:stun4.l.google.com:19302",
      ],
    },
  ],
  iceCandidatePoolSize: 10,
};

export class WebRTCService {
  peerConnection: RTCPeerConnection | null = null;
  localStream: MediaStream | null = null;
  remoteStream: MediaStream | null = null;
  
  // RTDB Unsubscribes (using 'off')
  // We store the ref and the callback to properly unbind later
  rtdbListeners: { ref: any, callback: (snap: DataSnapshot) => void }[] = [];
  
  processedCandidates: Set<string> = new Set();
  
  // Signaling state tracking
  private remoteDescriptionSet = false;
  private settingRemoteDescription = false;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private isDisposed = false;

  constructor() {
    console.log("PulseRTC: Service initialized");
  }

  async setupLocalMedia(): Promise<MediaStream> {
    console.log("PulseRTC: Setting up local media...");
    if (this.isDisposed) throw new Error("Service disposed");
    
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Media devices API not supported");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        },
      });
      if (this.isDisposed) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error("Service disposed during media setup");
      }
      this.localStream = stream;
      console.log("PulseRTC: Local media acquired", stream.id);
      return stream;
    } catch (e: any) {
      console.error("PulseRTC: Error accessing microphone.", e);
      throw e;
    }
  }

  createPeerConnection(onTrack: (stream: MediaStream) => void) {
    if (this.isDisposed) return null;
    console.log("PulseRTC: Creating PeerConnection");
    this.peerConnection = new RTCPeerConnection(servers);
    this.remoteStream = new MediaStream();
    this.remoteDescriptionSet = false;
    this.settingRemoteDescription = false;
    this.candidateQueue = [];
    this.processedCandidates.clear();

    // Add local tracks
    this.localStream?.getTracks().forEach((track) => {
      if (this.peerConnection && this.localStream) {
        this.peerConnection.addTrack(track, this.localStream);
      }
    });

    // Handle remote tracks
    this.peerConnection.ontrack = (event) => {
      console.log("PulseRTC: Remote track received", event.streams[0].id);
      event.streams[0].getTracks().forEach((track) => {
        this.remoteStream?.addTrack(track);
      });
      onTrack(this.remoteStream!);
    };

    return this.peerConnection;
  }

  private async processBufferedCandidates() {
    console.log(`PulseRTC: Processing ${this.candidateQueue.length} buffered candidates`);
    for (const candidate of this.candidateQueue) {
      try {
        if (this.peerConnection && !this.isDisposed) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (e) {
        console.error("PulseRTC: Error adding buffered candidate", e);
      }
    }
    this.candidateQueue = [];
  }

  async createCall(
    callerId: string,
    calleeId: string,
    metadata?: Record<string, any>,
  ): Promise<string> {
    if (!this.peerConnection) throw new Error("PeerConnection not initialized");
    if (this.isDisposed) throw new Error("Service disposed");

    // RTDB: Push new call to 'calls' node
    const callsRef = ref(rtdb, "calls");
    const newCallRef = push(callsRef);
    const callId = newCallRef.key as string;
    
    console.log("PulseRTC: Creating call (RTDB)", callId);

    // 1. Listen for ICE candidates locally and push to RTDB
    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate && !this.isDisposed) {
        try {
           const candidatesRef = ref(rtdb, `calls/${callId}/offerCandidates`);
           await push(candidatesRef, event.candidate.toJSON());
        } catch (e) {
          console.error("PulseRTC: Error uploading caller candidate", e);
        }
      }
    };

    // 2. Create Offer
    const offerDescription = await this.peerConnection.createOffer();
    if (this.isDisposed) throw new Error("Service disposed during offer creation");
    
    await this.peerConnection.setLocalDescription(offerDescription);

    // 3. Write Initial Data to RTDB
    const callData = {
      callId,
      callerId,
      calleeId,
      type: "PTT",
      offer: {
        type: offerDescription.type,
        sdp: offerDescription.sdp,
      },
      status: "OFFERING", 
      timestamp: Date.now(),
      ...metadata,
    };

    await set(newCallRef, callData);

    // 4. Listen for Answer in RTDB
    const callRef = ref(rtdb, `calls/${callId}`);
    const answerListener = onValue(callRef, async (snapshot) => {
      if (this.isDisposed) return;
      const data = snapshot.val();
      if (!this.peerConnection || !data) return;

      // A. Handle Remote Description (Answer)
      if (data.answer && !this.remoteDescriptionSet && !this.settingRemoteDescription) {
        if (this.peerConnection.signalingState === 'have-local-offer') {
            this.settingRemoteDescription = true;
            console.log("PulseRTC: Received Answer from Callee");
            const answerDescription = new RTCSessionDescription(data.answer);
            try {
              await this.peerConnection.setRemoteDescription(answerDescription);
              this.remoteDescriptionSet = true;
              await this.processBufferedCandidates();
            } catch (e) {
              console.error("PulseRTC: Error setting remote description", e);
            } finally {
              this.settingRemoteDescription = false;
            }
        }
      }
    });
    this.rtdbListeners.push({ ref: callRef, callback: answerListener });

    // 5. Listen for Answer Candidates in RTDB
    const answerCandidatesRef = ref(rtdb, `calls/${callId}/answerCandidates`);
    const candidatesListener = onValue(answerCandidatesRef, async (snapshot) => {
      if (this.isDisposed) return;
      const candidates = snapshot.val();
      if (!candidates) return;

      // Iterate keys since RTDB stores lists as objects with push IDs
      Object.values(candidates).forEach(async (candidate: any) => {
          const candStr = JSON.stringify(candidate);
          if (!this.processedCandidates.has(candStr)) {
            this.processedCandidates.add(candStr);
            if (this.remoteDescriptionSet) {
              try {
                await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) { console.error("PulseRTC: Error adding answer candidate", e); }
            } else {
              this.candidateQueue.push(candidate);
            }
          }
      });
    });
    this.rtdbListeners.push({ ref: answerCandidatesRef, callback: candidatesListener });

    return callId;
  }

  async answerCall(callId: string) {
    console.log("PulseRTC: Answering Call (RTDB)", callId);
    if (!this.peerConnection) throw new Error("PeerConnection not initialized");
    if (this.isDisposed) throw new Error("Service disposed");

    const callRef = ref(rtdb, `calls/${callId}`);
    const snapshot = await get(callRef);
    
    if (!snapshot.exists()) {
       throw new Error("Call not found");
    }
    
    const callData = snapshot.val();

    // 1. Listen for ICE candidates locally and push to RTDB
    this.peerConnection.onicecandidate = async (event) => {
      if (event.candidate && !this.isDisposed) {
        try {
          const candidatesRef = ref(rtdb, `calls/${callId}/answerCandidates`);
          await push(candidatesRef, event.candidate.toJSON());
        } catch (e) { console.error("PulseRTC: Error uploading callee candidate", e); }
      }
    };

    // 2. Set Remote Description (Offer) IMMEDIATELY
    if (this.peerConnection.signalingState === 'stable') {
        const offerDescription = callData.offer;
        try {
          await this.peerConnection.setRemoteDescription(
            new RTCSessionDescription(offerDescription),
          );
          this.remoteDescriptionSet = true;
        } catch (e) {
          console.error("PulseRTC: Failed to set remote description", e);
          throw e;
        }
    }

    // 3. Create Answer
    const answerDescription = await this.peerConnection.createAnswer();
    if (this.isDisposed) throw new Error("Service disposed during answer creation");

    await this.peerConnection.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };

    // Update RTDB
    await update(callRef, { answer, status: "CONNECTED" });

    // 4. Process Existing Offer Candidates from RTDB
    // We check the separate node `offerCandidates`
    const offerCandidatesRef = ref(rtdb, `calls/${callId}/offerCandidates`);
    
    // One-time fetch for existing
    const candidatesSnap = await get(offerCandidatesRef);
    if (candidatesSnap.exists()) {
        const candidates = candidatesSnap.val();
        Object.values(candidates).forEach(async (candidate: any) => {
            const candStr = JSON.stringify(candidate);
            if (!this.processedCandidates.has(candStr)) {
              this.processedCandidates.add(candStr);
              try {
                await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (e) {}
            }
        });
    }

    // 5. Listen for NEW Offer Candidates
    const listener = onValue(offerCandidatesRef, async (snapshot) => {
      if (this.isDisposed) return;
      const candidates = snapshot.val();
      if (!candidates) return;

      Object.values(candidates).forEach(async (candidate: any) => {
         const candStr = JSON.stringify(candidate);
         if (!this.processedCandidates.has(candStr)) {
            this.processedCandidates.add(candStr);
            if (this.remoteDescriptionSet) {
                try {
                    await this.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (e) {}
            } else {
                this.candidateQueue.push(candidate);
            }
         }
      });
    });
    this.rtdbListeners.push({ ref: offerCandidatesRef, callback: listener });
  }

  async cleanup(callId: string | null) {
    console.log("PulseRTC: Cleaning up session");
    this.isDisposed = true; 
    
    // Detach RTDB listeners
    this.rtdbListeners.forEach(({ ref, callback }) => {
        off(ref, "value", callback);
    });
    this.rtdbListeners = [];
    
    this.processedCandidates.clear();
    this.candidateQueue = [];
    this.remoteDescriptionSet = false;
    this.settingRemoteDescription = false;

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
    this.remoteStream = null;

    if (callId) {
      try {
        const callRef = ref(rtdb, `calls/${callId}`);
        const snap = await get(callRef);
        
        if (snap.exists()) {
          const data = snap.val();
          
          // ARCHIVE TO FIRESTORE before deleting from RTDB
          // This satisfies: "Call History: Firestore"
          if (data.status !== "ENDED" && data.status !== "REJECTED") {
              const historyData = { ...data, status: "ENDED", endedAt: Date.now() };
              // We don't need all candidates in history usually, saving space
              delete historyData.offerCandidates;
              delete historyData.answerCandidates;
              
              const historyRef = doc(collection(db, "calls")); // Firestore
              await setDoc(historyRef, historyData);
              
              // Remove from RTDB to keep it lightweight
              await remove(callRef);
          } else {
             await remove(callRef);
          }
        }
      } catch (e) {
        console.warn("PulseRTC: Cleanup failed", e);
      }
    }
  }
}

export const webRTCService = new WebRTCService();
