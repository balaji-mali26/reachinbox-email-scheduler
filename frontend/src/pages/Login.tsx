import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';

export const Login: React.FC = () => {
  const { loginWithGoogle, loginWithEmail, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const errorParam = searchParams.get('error');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setLocalError('Please enter your email ID');
      return;
    }
    setLocalError('');
    setSubmitting(true);
    try {
      await loginWithEmail(email.trim(), password);
      navigate('/');
    } catch (err: any) {
      setLocalError(err.message || 'Failed to login');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="max-w-[380px] w-full bg-white rounded-2xl border border-gray-100 shadow-[0_4px_25px_rgba(0,0,0,0.03)] p-8 sm:p-10 text-center">
        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-7">
          Login
        </h1>

        {/* Google Login Button */}
        <button
          onClick={loginWithGoogle}
          disabled={loading || submitting}
          className="w-full inline-flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl bg-[#E8F7F0] hover:bg-[#DCF3E7] text-gray-800 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
        >
          {/* Google G SVG */}
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Login with Google</span>
        </button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-100" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-white px-3 text-gray-400 font-normal">
              or sign up through email
            </span>
          </div>
        </div>

        {/* Error Notification */}
        {(errorParam || localError) && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-xs flex items-center gap-2 text-left">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{localError || errorParam}</span>
          </div>
        )}

        {/* Email & Password Form */}
        <form onSubmit={handleEmailLogin} className="space-y-3">
          <div>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email ID"
              className="w-full bg-[#F3F4F6] text-gray-800 placeholder-gray-400 text-sm px-4 py-3 rounded-xl border border-transparent focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-[#F3F4F6] text-gray-800 placeholder-gray-400 text-sm px-4 py-3 rounded-xl border border-transparent focus:bg-white focus:border-emerald-500 focus:outline-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || loading}
            className="w-full mt-2 bg-[#00A854] hover:bg-[#009249] text-white text-sm font-medium py-3 px-4 rounded-xl transition-colors shadow-xs cursor-pointer disabled:opacity-60"
          >
            {submitting ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
};
