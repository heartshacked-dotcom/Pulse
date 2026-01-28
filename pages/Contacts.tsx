import React, { useEffect, useState } from 'react';
import { collection, query, limit, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../context/AuthContext';
import { useCall } from '../context/CallContext';
import { CallType, UserProfile } from '../types';
import { DEFAULT_AVATAR } from '../constants';
import { Phone, Video, Search } from 'lucide-react';

const Contacts: React.FC = () => {
  const { user } = useAuth();
  const { makeCall } = useCall();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) return;

    const fetchUsers = async () => {
      try {
        // Fetch users (limited to 50 for this demo)
        // Note: orderBy might require an index. If it fails, remove orderBy.
        const q = query(collection(db, 'users'), limit(50));
        const querySnapshot = await getDocs(q);
        
        const fetchedUsers: UserProfile[] = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data() as UserProfile;
            if (data.uid !== user?.uid) {
                fetchedUsers.push(data);
            }
        });
        
        // Sort manually by lastActive (desc) to avoid index requirement for now
        fetchedUsers.sort((a, b) => {
             const tA = a.lastActive || 0;
             const tB = b.lastActive || 0;
             return tB - tA;
        });

        setUsers(fetchedUsers);
      } catch (error) {
        console.error("Error fetching contacts:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, [user]);

  const isOnline = (timestamp: any) => {
      if (!timestamp) return false;
      const now = Date.now();
      // Firestore timestamp object handling
      const millis = timestamp.toMillis ? timestamp.toMillis() : timestamp;
      return (now - millis) < 1000 * 60 * 5; // 5 minutes active
  };

  if (loading) return <div className="p-4 text-center text-gray-500">Loading contacts...</div>;

  return (
    <div className="pb-20 pt-4 px-4 space-y-4">
      <h1 className="text-2xl font-bold mb-4">Contacts</h1>
      
      <div className="relative mb-6">
        <input 
            type="text" 
            placeholder="Search contacts..." 
            className="w-full bg-gray-800 rounded-xl py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-primary outline-none"
        />
        <Search className="absolute left-3 top-3.5 text-gray-500" size={18} />
      </div>

      <div className="space-y-3">
        {users.map((u) => (
          <div key={u.uid} className="flex items-center justify-between bg-card p-4 rounded-xl border border-gray-800">
            <div className="flex items-center space-x-4">
              <div className="relative">
                  <img 
                    src={u.photoURL || DEFAULT_AVATAR} 
                    className="w-12 h-12 rounded-full bg-gray-700 object-cover"
                    alt={u.displayName}
                  />
                  {isOnline(u.lastActive) && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-card"></div>
                  )}
              </div>
              <div>
                <h3 className="font-semibold text-white">{u.displayName}</h3>
                <p className="text-xs text-gray-400">
                    {isOnline(u.lastActive) ? 'Online' : 'Offline'}
                </p>
              </div>
            </div>
            
            <div className="flex space-x-2">
                <button 
                    onClick={() => makeCall(u.uid, u.displayName, CallType.AUDIO)}
                    className="p-3 bg-gray-800 rounded-full hover:bg-primary transition-colors"
                >
                    <Phone size={18} />
                </button>
                <button 
                    onClick={() => makeCall(u.uid, u.displayName, CallType.VIDEO)}
                    className="p-3 bg-gray-800 rounded-full hover:bg-purple-600 transition-colors"
                >
                    <Video size={18} />
                </button>
            </div>
          </div>
        ))}
        {users.length === 0 && (
            <p className="text-center text-gray-500 mt-10">No other users found.</p>
        )}
      </div>
    </div>
  );
};

export default Contacts;