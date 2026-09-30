import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { SlackChannel } from '../types';
import {
  X,
  Slack,
  CheckCircle2,
  AlertCircle,
  Trash2,
  RotateCw,
} from 'lucide-react';

interface SlackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SlackModal: React.FC<SlackModalProps> = ({ isOpen, onClose }) => {
  const { user, refreshUser } = useAuth();
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isConnected = !!user?.slackConnection?.channelId || !!user?.slackConnection?.teamName;

  useEffect(() => {
    if (isOpen) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('slack') === 'connected') {
        setSuccessMessage('Slack connected successfully! Please select your alert channel below.');
      } else if (params.get('slack_error')) {
        const errParam = params.get('slack_error');
        setError(
          errParam === 'access_denied'
            ? 'Slack authorization was cancelled or denied.'
            : `Slack authorization failed: ${errParam}`
        );
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && isConnected) {
      loadChannels();
      if (user?.slackConnection?.channelId) {
        setSelectedChannelId(user.slackConnection.channelId);
      }
    }
  }, [isOpen, isConnected]);

  const loadChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/slack/channels');
      const list: SlackChannel[] = res.data.data;
      setChannels(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load channels from Slack');
    } finally {
      setLoading(false);
    }
  };

  const handleChannelSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const channelId = e.target.value;
    setSelectedChannelId(channelId);
    const chosen = channels.find((c) => c.id === channelId);

    setSavingChannel(true);
    setError(null);
    try {
      const channelLabel = chosen ? (chosen.name.startsWith('#') ? chosen.name : `#${chosen.name}`) : channelId;
      await api.post('/slack/select-channel', {
        channelId,
        channelName: channelLabel,
      });
      await refreshUser();
      setSuccessMessage(`Notifications will be sent to ${channelLabel}.`);
    } catch (err: any) {
      setError(err.message || 'Failed to update channel');
    } finally {
      setSavingChannel(false);
    }
  };

  const handleConnectSlack = () => {
    setConnecting(true);
    setError(null);
    setSuccessMessage(null);
    window.location.href = '/api/slack/connect';
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Are you sure you want to disconnect Slack notifications?')) {
      return;
    }

    try {
      await api.post('/slack/disconnect');
      await refreshUser();
      setSuccessMessage(null);
      setSelectedChannelId('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect Slack');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-pink-50 text-[#E01E5A] flex items-center justify-center">
              <Slack className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Slack Integration</h2>
              <p className="text-xs text-gray-500">Rate-limit breach notifications</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMessage}</span>
            </div>
          )}

          {isConnected ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-xs font-bold text-emerald-950">
                      {user?.slackConnection?.teamName || 'Slack Connected'}
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      Target channel: {user?.slackConnection?.channelName || user?.slackConnection?.channelId || 'Not selected'}
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
                  Notification Channel
                </label>
                {loading ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500 py-2">
                    <RotateCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading your Slack channels...</span>
                  </div>
                ) : (
                  <select
                    value={selectedChannelId}
                    onChange={handleChannelSelect}
                    disabled={savingChannel}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  >
                    <option value="">-- Choose target channel --</option>
                    {channels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        #{ch.name} {ch.isPrivate ? '(Private)' : ''}
                      </option>
                    ))}
                  </select>
                )}
                {savingChannel && (
                  <p className="text-[11px] text-indigo-600 mt-1 flex items-center gap-1">
                    <RotateCw className="h-3 w-3 animate-spin" />
                    <span>Saving target channel...</span>
                  </p>
                )}
                <p className="text-[11px] text-gray-500 mt-1">
                  Whenever an hourly rate limit is reached, a rich alert will be dispatched to this channel.
                </p>
              </div>

              <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConnectSlack}
                    disabled={connecting}
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    title="Re-authorize or connect another workspace"
                  >
                    {connecting ? (
                      <>
                        <RotateCw className="h-3 w-3 animate-spin" />
                        <span>Connecting...</span>
                      </>
                    ) : (
                      <span>Reconnect</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Disconnect</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-4 space-y-4">
              <div className="h-12 w-12 rounded-2xl bg-pink-50 text-[#E01E5A] flex items-center justify-center mx-auto shadow-sm">
                <Slack className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">Connect your Slack Workspace</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
                  Receive instant Slack alerts whenever any sender account exceeds its hourly send limit.
                </p>
              </div>

              <button
                onClick={handleConnectSlack}
                disabled={connecting}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#4A154B] hover:bg-[#3D113E] shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                {connecting ? (
                  <>
                    <RotateCw className="h-4 w-4 animate-spin" />
                    <span>Connecting to Slack...</span>
                  </>
                ) : (
                  <>
                    <Slack className="h-4 w-4" />
                    <span>Connect with Slack</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
