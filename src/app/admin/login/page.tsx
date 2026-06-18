'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Lock } from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      });

      if (res.ok) {
        router.push('/admin/dashboard');
      } else {
        setError('Invalid credentials');
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center py-16">
      <div className="w-full max-w-sm mx-auto px-6">
        <div className="text-center mb-8">
          <Image
            src="/images/brand/logo.png"
            alt="Amamma Jaadi"
            width={64}
            height={64}
            className="mx-auto rounded-full mb-4"
          />
          <h1 className="font-display text-2xl font-bold text-brand-charcoal">
            Admin Login
          </h1>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="font-body text-sm font-medium text-brand-charcoal/70 block mb-1">
              User ID
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="input-field"
              placeholder="admin"
              required
              autoComplete="username"
            />
          </div>

          <div>
            <label className="font-body text-sm font-medium text-brand-charcoal/70 block mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="font-body text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full gap-2"
          >
            <Lock size={16} />
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
