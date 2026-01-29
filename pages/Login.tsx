
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Radio, AlertTriangle, Mail, Lock, User, ArrowRight, ShieldCheck } from 'lucide-react';
import { APP_NAME } from '../constants';

export default function Login() {
  const { login, register } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  
  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(''); // Only for register
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        if (!name.trim()) throw new Error("Name is required");
        await register(email, password, name);
      }
    } catch (err: any) {
      setLoading(false);
      console.error(err);
      
      let msg = err.message;
      if (err.code === 'auth/invalid-credential') msg = "Access Denied: Invalid credentials.";
      if (err.code === 'auth/email-already-in-use') msg = "Email already registered.";
      if (err.code === 'auth/weak-password') msg = "Password weak. Require 6+ chars.";
      
      setError(msg);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-950 text-white relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-indigo-900/20 to-transparent pointer-events-none"></div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-12">
          <div className="w-24 h-24 bg-slate-900 rounded-[2rem] mx-auto flex items-center justify-center mb-6 shadow-2xl border border-white/5 relative">
             <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full"></div>
             <Radio size={48} className="text-primary relative z-10" />
          </div>
          <h2 className="text-5xl font-black text-white tracking-tighter italic">PULSE</h2>
          <p className="text-xs font-bold text-primary tracking-[0.4em] uppercase mt-2">Secure Voice Network</p>
        </div>

        <div className="bg-slate-900/50 backdrop-blur-xl p-8 rounded-[2rem] border border-white/10 shadow-2xl">
            <div className="flex mb-8 bg-slate-950 p-1.5 rounded-2xl border border-white/5">
                <button 
                    onClick={() => { setIsLogin(true); setError(null); }}
                    className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${isLogin ? 'bg-slate-800 text-white shadow-lg border border-white/5' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Login
                </button>
                <button 
                    onClick={() => { setIsLogin(false); setError(null); }}
                    className={`flex-1 py-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${!isLogin ? 'bg-slate-800 text-white shadow-lg border border-white/5' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Register
                </button>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {!isLogin && (
                <div className="relative group">
                    <User className="absolute left-4 top-4 text-slate-500 group-focus-within:text-primary transition-colors" size={18} />
                    <input
                        type="text"
                        required
                        className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-600 font-medium"
                        placeholder="CODENAME (DISPLAY NAME)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
              )}

              <div className="relative group">
                <Mail className="absolute left-4 top-4 text-slate-500 group-focus-within:text-primary transition-colors" size={18} />
                <input
                    type="email"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-sm text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-600 font-medium"
                    placeholder="SECURE EMAIL"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="relative group">
                <Lock className="absolute left-4 top-4 text-slate-500 group-focus-within:text-primary transition-colors" size={18} />
                <input
                    type="password"
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-white focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all placeholder:text-slate-600 font-medium"
                    placeholder="ACCESS KEY"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
                  <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <p className="text-xs font-bold text-red-400 leading-relaxed">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-primary hover:bg-blue-600 rounded-2xl font-black text-white shadow-lg shadow-blue-500/20 flex items-center justify-center gap-3 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-6 uppercase tracking-widest text-xs"
              >
                {loading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                ) : (
                    <>
                        {isLogin ? 'Establish Link' : 'Initialize ID'}
                        <ArrowRight size={16} />
                    </>
                )}
              </button>
            </form>
        </div>
      </div>
    </div>
  );
}
