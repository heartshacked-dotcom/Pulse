import React, { useState, useEffect, useRef } from 'react';
import { useCall } from '../context/CallContext';
import { CallStatus, CallType, UserProfile } from '../types';
import { Radio, Zap, Volume2, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { collection, query, limit, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { DEFAULT_AVATAR } from '../constants';

const WalkieTalkie: React.FC = () => {
    const { makeCall, endCall, activeCall, callStatus, incomingCall, ensureAudioContext } = useCall();
    const { user } = useAuth();
    const [selectedFriend, setSelectedFriend] = useState<UserProfile | null>(null);
    const [users, setUsers] = useState<UserProfile[]>([]);
    const [isTalking, setIsTalking] = useState(false);
    const [isReady, setIsReady] = useState(false); // Used to unlock audio context

    useEffect(() => {
        if (!db) return;
        const fetchUsers = async () => {
            const q = query(collection(db, 'users'), limit(20));
            const snap = await getDocs(q);
            const list: UserProfile[] = [];
            snap.forEach(d => {
                const u = d.data() as UserProfile;
                if (u.uid !== user?.uid) list.push(u);
            });
            setUsers(list);
            if (list.length > 0) setSelectedFriend(list[0]);
        };
        fetchUsers();
    }, [user]);

    // Handle "Receive" state visually
    const isReceiving = incomingCall?.type === CallType.PTT && callStatus === CallStatus.CONNECTED;
    const currentFriendId = isReceiving ? incomingCall?.callerId : selectedFriend?.uid;

    // Find the friend object for the current interaction
    const activeFriend = users.find(u => u.uid === currentFriendId) || selectedFriend;

    const handleTouchStart = async (e: React.TouchEvent | React.MouseEvent) => {
        e.preventDefault();
        if (!selectedFriend || isReceiving) return;
        
        // Vibration feedback
        if (navigator.vibrate) navigator.vibrate(50);

        setIsTalking(true);
        try {
            await makeCall(selectedFriend.uid, selectedFriend.displayName, CallType.PTT);
        } catch (e) {
            console.error(e);
            setIsTalking(false);
        }
    };

    const handleTouchEnd = async (e: React.TouchEvent | React.MouseEvent) => {
        e.preventDefault();
        if (!isTalking) return;
        
        setIsTalking(false);
        await endCall();
    };

    const activateApp = () => {
        ensureAudioContext();
        setIsReady(true);
    };

    if (!isReady) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8 bg-dark relative z-50">
                <div className="w-32 h-32 rounded-full bg-secondary flex items-center justify-center mb-8 animate-pulse shadow-[0_0_50px_rgba(59,130,246,0.5)]">
                    <Radio size={48} className="text-primary" />
                </div>
                <h2 className="text-2xl font-bold mb-4">Tap to go Online</h2>
                <p className="text-gray-400 text-center mb-8">Pulse needs to activate your speaker to receive messages.</p>
                <button 
                    onClick={activateApp}
                    className="w-full max-w-xs py-4 bg-primary text-white font-bold rounded-2xl shadow-lg active:scale-95 transition-transform"
                >
                    Connect
                </button>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-dark overflow-hidden safe-area-top safe-area-bottom">
            {/* Header / Friend Carousel */}
            <div className="pt-4 pb-2 px-4 bg-secondary/30 backdrop-blur-sm border-b border-gray-800">
                <div className="flex overflow-x-auto space-x-4 pb-2 scrollbar-hide snap-x">
                    {users.map(friend => {
                        const isSelected = selectedFriend?.uid === friend.uid;
                        return (
                            <button
                                key={friend.uid}
                                onClick={() => !isReceiving && !isTalking && setSelectedFriend(friend)}
                                className={`flex flex-col items-center space-y-1 min-w-[70px] snap-center transition-opacity ${isSelected ? 'opacity-100' : 'opacity-50 grayscale'}`}
                            >
                                <div className={`w-14 h-14 rounded-full p-0.5 ${isSelected ? 'bg-gradient-to-tr from-primary to-accent' : 'bg-gray-700'}`}>
                                    <img 
                                        src={friend.photoURL || DEFAULT_AVATAR} 
                                        className="w-full h-full rounded-full object-cover border-2 border-dark"
                                    />
                                </div>
                                <span className="text-[10px] font-bold truncate max-w-[70px]">{friend.displayName}</span>
                            </button>
                        );
                    })}
                    {users.length === 0 && (
                         <div className="text-gray-500 text-sm py-4 w-full text-center">Add friends to talk</div>
                    )}
                </div>
            </div>

            {/* Main PTT Area */}
            <div className="flex-1 relative flex flex-col items-center justify-center p-6">
                
                {/* Status Indicator */}
                <div className="absolute top-10 flex items-center space-x-2">
                    {isTalking ? (
                        <span className="text-accent font-black tracking-widest animate-pulse flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-accent"></div> TRANSMITTING
                        </span>
                    ) : isReceiving ? (
                        <span className="text-green-500 font-black tracking-widest animate-pulse flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-green-500"></div> RECEIVING
                        </span>
                    ) : (
                        <span className="text-gray-600 font-bold tracking-widest text-xs">HOLD TO TALK</span>
                    )}
                </div>

                {/* Main Avatar / Visualizer */}
                <div className="relative mb-8">
                     {/* Ripples */}
                    {(isTalking || isReceiving) && (
                        <>
                            <div className={`absolute inset-0 rounded-full animate-ping opacity-20 ${isReceiving ? 'bg-green-500' : 'bg-accent'}`}></div>
                            <div className={`absolute -inset-4 rounded-full animate-pulse opacity-10 ${isReceiving ? 'bg-green-500' : 'bg-accent'}`}></div>
                        </>
                    )}

                    <div className={`w-64 h-64 rounded-[3rem] overflow-hidden border-8 shadow-2xl transition-all duration-200 
                        ${isTalking ? 'border-accent scale-105' : isReceiving ? 'border-green-500 scale-105' : 'border-gray-800'}`
                    }>
                        {activeFriend ? (
                            <img 
                                src={activeFriend.photoURL || DEFAULT_AVATAR} 
                                className="w-full h-full object-cover" 
                                draggable={false}
                            />
                        ) : (
                            <div className="w-full h-full bg-gray-800 flex items-center justify-center">
                                <UserIcon size={64} className="text-gray-600" />
                            </div>
                        )}
                        
                        {/* Overlay Gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                        
                        <div className="absolute bottom-6 left-0 right-0 text-center">
                             <h2 className="text-3xl font-black text-white drop-shadow-lg">
                                 {activeFriend?.displayName || "Select Friend"}
                             </h2>
                        </div>
                    </div>
                </div>

                {/* Big Trigger Button (Invisible but covers area) */}
                <div 
                    className="absolute inset-0 z-10"
                    onMouseDown={handleTouchStart}
                    onMouseUp={handleTouchEnd}
                    onMouseLeave={handleTouchEnd}
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                ></div>

                {/* Helper Text */}
                <div className="mt-auto mb-10 text-gray-500 flex items-center gap-2 pointer-events-none">
                     {callStatus === CallStatus.OFFERING && isTalking && (
                         <span className="text-xs">Connecting...</span>
                     )}
                     <Volume2 size={16} />
                     <span className="text-xs font-mono">SPEAKER ON</span>
                </div>
            </div>
        </div>
    );
};

export default WalkieTalkie;