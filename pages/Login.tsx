import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { UserCircle2, AlertTriangle, Mail, Lock, User, ArrowRight } from 'lucide-react';
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
      // Success is handled by auth state listener in context
    } catch (err: any) {
      setLoading(false);
      console.error(err);
      
      let msg = err.message;
      if (err.code === 'auth/invalid-credential') msg = "Invalid email or password.";
      if (err.code === 'auth/email-already-in-use') msg = "Email is already registered.";
      if (err.code === 'auth/weak-password') msg = "Password should be at least 6 characters.";
      
      setError(msg);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-dark transition-all">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="w-20 h-20 bg-secondary rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-xl border border-gray-700">
             <UserCircle2 size={48} className="text-primary" />
          </div>
          <h2 className="text-4xl font-bold text-white tracking-tight">{APP_NAME}</h2>
          <p className="mt-2 text-gray-400">Real-time Voice Communication</p>
        </div>

        <div className="bg-secondary/50 backdrop-blur-sm p-8 rounded-3xl border border-gray-800 shadow-2xl">
            <div className="flex mb-8 bg-gray-900/50 p-1 rounded-xl">
                <button 
                    onClick={() => { setIsLogin(true); setError(null); }}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${isLogin ? 'bg-primary text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                >
                    Sign In
                </button>
                <button 
                    onClick={() => { setIsLogin(false); setError(null); }}
                    className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${!isLogin ? 'bg-primary text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                >
                    Create Account
                </button>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              {!isLogin && (
                <div className="relative group">
                    <User className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-primary transition-colors" size={20} />
                    <input
                        type="text"
                        required
                        className="w-full bg-dark/50 border border-gray-700 rounded-xl py-3 pl-12 pr-4 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                        placeholder="Display Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
              )}

              <div className="relative group">
                <Mail className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-primary transition-colors" size={20} />
                <input
                    type="email"
                    required
                    className="w-full bg-dark/50 border border-gray-700 rounded-xl py-3 pl-12 pr-4 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    placeholder="Email Address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="relative group">
                <Lock className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-primary transition-colors" size={20} />
                <input
                    type="password"
                    required
                    className="w-full bg-dark/50 border border-gray-700 rounded-xl py-3 pl-12 pr-4 text-white focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                  <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <p className="text-sm text-red-200">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 bg-primary hover:bg-blue-600 rounded-xl font-bold text-white shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-4"
              >
                {loading ? (
                    <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                ) : (
                    <>
                        {isLogin ? 'Sign In' : 'Create Account'}
                        <ArrowRight size={18} />
                    </>
                )}
              </button>
            </form>
        </div>
      </div>
    </div>
  );
}