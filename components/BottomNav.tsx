
import React from 'react';
import { Radio, User, ShieldCheck } from 'lucide-react';

interface Props {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const BottomNav: React.FC<Props> = ({ currentPage, onNavigate }) => {
  const navItems = [
    { id: 'ptt', icon: Radio, label: 'COMMS' },
    { id: 'profile', icon: ShieldCheck, label: 'ID CARD' },
  ];

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full px-6 max-w-sm">
      <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-[2rem] shadow-2xl shadow-black/50 p-1.5 flex justify-between items-center relative">
        
        {/* Active Indicator Background */}
        <div 
           className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-slate-800 rounded-[1.5rem] transition-all duration-300 ease-out border border-white/5 ${currentPage === 'profile' ? 'left-[calc(50%+3px)]' : 'left-1.5'}`}
        />

        {navItems.map((item) => {
           const isActive = currentPage === item.id;
           return (
             <button
               key={item.id}
               onClick={() => onNavigate(item.id)}
               className={`relative z-10 flex-1 flex flex-col items-center justify-center py-3 rounded-[1.5rem] transition-colors duration-300 ${
                 isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300'
               }`}
             >
               <item.icon size={22} className={`mb-1 transition-transform duration-300 ${isActive ? 'scale-110' : 'scale-100'}`} />
               <span className="text-[9px] font-black tracking-widest">{item.label}</span>
             </button>
           );
        })}
      </div>
    </div>
  );
};

export default BottomNav;
