
import { db } from "./firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from "firebase/firestore";

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

  constructor() {}

  async setupLocalMedia(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Media devices API not supported");
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      this.localStream = stream;
      return stream;
    } catch (e: any) {
      console.error("Error accessing microphone.", e.name, e.message);
      throw e;
    }
  }

  createPeerConnection(onTrack: (stream: MediaStream) => void) {
    this.peerConnection = new RTCPeerConnection(servers);
    this.remoteStream = new MediaStream();

    this.localStream?.getTracks().forEach((track) => {
      if (this.peerConnection && this.localStream) {
        this.peerConnection.addTrack(track, this.localStream);
      }
    });

    this.peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        this.remoteStream?.addTrack(track);
      });
      onTrack(this.remoteStream!);
    };

    return this.peerConnection;
  }

  async createCall(
    callerId: string,
    calleeId: string,
    metadata?: Record<string, any>,
  ): Promise<string> {
    if (!this.peerConnection) throw new Error("PeerConnection not initialized");

    const callDocRef = doc(collection(db, "calls"));
    const offerCandidatesCol = collection(callDocRef, "offerCandidates");

    // Queue for ICE candidates to ensure they are written AFTER the parent document exists
    let callDocCreated = false;
    const candidateQueue: RTCIceCandidate[] = [];

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        if (callDocCreated) {
          addDoc(offerCandidatesCol, {
            candidate: event.candidate.toJSON(),
            type: "caller",
          });
        } else {
          candidateQueue.push(event.candidate);
        }
      }
    };

    const offerDescription = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offerDescription);

    const callData = {
      callId: callDocRef.id,
      callerId,
      calleeId,
      type: "PTT",
      offer: {
        type: offerDescription.type,
        sdp: offerDescription.sdp,
      },
      status: "offering",
      timestamp: Date.now(),
      ...metadata,
    };

    await setDoc(callDocRef, callData);
    
    // Parent document created, flush the queue
    callDocCreated = true;
    candidateQueue.forEach((candidate) => {
      addDoc(offerCandidatesCol, {
        candidate: candidate.toJSON(),
        type: "caller",
      });
    });

    onSnapshot(callDocRef, (snapshot) => {
      const data = snapshot.data();
      if (
        !this.peerConnection?.currentRemoteDescription &&
        data?.answer &&
        this.peerConnection
      ) {
        const answerDescription = new RTCSessionDescription(data.answer);
        this.peerConnection.setRemoteDescription(answerDescription);
      }
    });

    const answerCandidatesCol = collection(callDocRef, "answerCandidates");
    onSnapshot(answerCandidatesCol, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (this.peerConnection) {
            const candidate = new RTCIceCandidate(data.candidate);
            this.peerConnection.addIceCandidate(candidate);
          }
        }
      });
    });

    return callDocRef.id;
  }

  async answerCall(callId: string) {
    if (!this.peerConnection) throw new Error("PeerConnection not initialized");

    const callDocRef = doc(db, "calls", callId);
    const answerCandidatesCol = collection(callDocRef, "answerCandidates");
    const callSnap = await getDoc(callDocRef);
    const callData = callSnap.data();

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        addDoc(answerCandidatesCol, {
          candidate: event.candidate.toJSON(),
          type: "answer",
        });
      }
    };

    const offerDescription = callData?.offer;
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(offerDescription),
    );

    const answerDescription = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answerDescription);

    const answer = {
      type: answerDescription.type,
      sdp: answerDescription.sdp,
    };

    await updateDoc(callDocRef, { answer, status: "connected" });

    const offerCandidatesCol = collection(callDocRef, "offerCandidates");
    onSnapshot(offerCandidatesCol, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          if (this.peerConnection) {
            const candidate = new RTCIceCandidate(data.candidate);
            this.peerConnection.addIceCandidate(candidate);
          }
        }
      });
    });
  }

  async cleanup(callId: string | null) {
    if (this.peerConnection) {
      this.peerConnection.getReceivers().forEach((receiver) => {
        if (receiver.track) {
          receiver.track.stop();
          receiver.track.enabled = false;
        }
      });
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
      this.localStream = null;
    }
    this.remoteStream = null;

    if (callId) {
      try {
        const callRef = doc(db, "calls", callId);
        const snap = await getDoc(callRef);
        if (snap.exists()) {
          const data = snap.data();
          if (data.status !== "ended" && data.status !== "rejected") {
            const endedAt = Date.now();
            await updateDoc(callRef, {
              status: "ended",
              endedAt,
            });
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }
}

export const webRTCService = new WebRTCService();
