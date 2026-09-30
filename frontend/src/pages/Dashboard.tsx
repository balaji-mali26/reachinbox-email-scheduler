import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { EmailJob, SearchResultResponse } from '../types';
import { useAuth } from '../context/AuthContext';
import { SlackModal } from '../components/SlackModal';
import { EmailDetail } from '../components/EmailDetail';
import { ComposeEmailView } from '../components/ComposeEmailView';
import { Toast } from '../components/Toast';
import { format } from 'date-fns';
import {
  Clock,
  Send,
  Search,
  Filter,
  RotateCw,
  Star,
  ChevronDown,
  LogOut,
  Sliders,
  ExternalLink,
  Trash2,
} from 'lucide-react';

interface DashboardProps {
  initialTab?: 'scheduled' | 'sent';
}

export const Dashboard: React.FC<DashboardProps> = ({ initialTab = 'scheduled' }) => {
  const { user, logout, refreshUser } = useAuth();
  const [currentView, setCurrentView] = useState<'list' | 'detail' | 'compose'>('list');
  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>(initialTab);
  const [selectedEmail, setSelectedEmail] = useState<EmailJob | null>(null);

  // Real live data strictly from PostgreSQL via API
  const [scheduledEmails, setScheduledEmails] = useState<EmailJob[]>([]);
  const [sentEmails, setSentEmails] = useState<EmailJob[]>([]);
  const [scheduledTotal, setScheduledTotal] = useState<number>(0);
  const [sentTotal, setSentTotal] = useState<number>(0);

  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultResponse['data'] | null>(null);

  // Menus & Modals
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isSlackOpen, setIsSlackOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const fetchScheduled = useCallback(async () => {
    try {
      const res = await api.get('/emails/scheduled?page=1&limit=50');
      const items: EmailJob[] = res.data.data.items || [];
      const total = res.data.data.pagination?.total ?? items.length;
      setScheduledEmails(items);
      setScheduledTotal(total);
    } catch (_err) {
      setScheduledEmails([]);
      setScheduledTotal(0);
    }
  }, []);

  const fetchSent = useCallback(async () => {
    try {
      const res = await api.get('/emails/sent?page=1&limit=50');
      const items: EmailJob[] = res.data.data.items || [];
      const total = res.data.data.pagination?.total ?? items.length;
      setSentEmails(items);
      setSentTotal(total);
    } catch (_err) {
      setSentEmails([]);
      setSentTotal(0);
    }
  }, []);

  const executeSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setLoading(true);
    try {
      const res = await api.get(`/emails/search?q=${encodeURIComponent(query)}&page=1&limit=50`);
      setSearchResults(res.data.data);
    } catch (_err) {
      setSearchResults(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchScheduled(), fetchSent()]);
    if (searchQuery) {
      await executeSearch(searchQuery);
    }
    setLoading(false);
  }, [fetchScheduled, fetchSent, searchQuery, executeSearch]);

  const handleManualRefresh = async () => {
    try {
      await refreshAll();
      setToast({ message: 'Email list refreshed successfully.', type: 'info' });
    } catch (_err) {
      setToast({ message: 'Failed to refresh emails. Please check your connection.', type: 'error' });
    }
  };

  const handleClearEmails = async () => {
    if (!window.confirm('Clear all demo emails from database to start fresh?')) return;
    setIsProfileMenuOpen(false);
    setLoading(true);
    try {
      await api.post('/emails/clear');
      await refreshAll();
      setToast({ message: 'All demo email data cleared successfully.', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to clear emails', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshAll();
    const interval = setInterval(() => {
      fetchScheduled();
      fetchSent();
    }, 4000);
    return () => clearInterval(interval);
  }, [fetchScheduled, fetchSent]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack') === 'connected' || params.get('slack_error')) {
      setIsSlackOpen(true);
      refreshUser();
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refreshUser]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    executeSearch(q);
  };

  // Determine current display list
  const currentList: EmailJob[] = searchResults
    ? searchResults.items
    : activeTab === 'scheduled'
    ? scheduledEmails
    : sentEmails;

  // View: Compose Full Screen
  if (currentView === 'compose') {
    return (
      <ComposeEmailView
        onBack={() => setCurrentView('list')}
        onSuccess={(msg?: string) => {
          refreshAll();
          if (msg) {
            setToast({ message: msg, type: 'success' });
          }
          setCurrentView('list');
        }}
        defaultSenderEmail={user?.email || 'oliver.brown@domain.io'}
      />
    );
  }

  // View: Detail Full Screen
  if (currentView === 'detail' && selectedEmail) {
    return (
      <EmailDetail
        email={selectedEmail}
        onBack={() => {
          setSelectedEmail(null);
          setCurrentView('list');
        }}
        userAvatar={user?.avatarUrl}
      />
    );
  }

  // View: Homepage with Sidebar and Email List
  return (
    <div className="flex min-h-screen bg-white font-sans text-gray-900">
      {/* 1. Left Sidebar */}
      <aside className="w-60 min-h-screen bg-white border-r border-gray-100 flex flex-col p-4 shrink-0">
        {/* Brand Logo */}
        <div className="px-2 pt-1 pb-4">
          <span className="text-2xl font-black tracking-tighter text-black font-mono select-none">
            ONE
          </span>
        </div>

        {/* User Profile Card */}
        <div className="relative mb-4">
          <div
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="w-full bg-[#F4F5F7] hover:bg-[#EBEDF0] p-2.5 rounded-xl flex items-center justify-between cursor-pointer transition select-none"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-full overflow-hidden bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center shrink-0 text-xs select-none">
                {user?.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.name || 'User'}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <span>{(user?.name || user?.email || 'U').charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-gray-900 truncate leading-tight">
                  {user?.name || 'User'}
                </p>
                <p className="text-[10px] text-gray-400 truncate leading-tight mt-0.5">
                  {user?.email || ''}
                </p>
              </div>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0 ml-1" />
          </div>

          {/* Profile Dropdown Menu */}
          {isProfileMenuOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-100 rounded-xl shadow-lg py-1.5 z-30 text-xs">
              <button
                onClick={() => {
                  setIsSlackOpen(true);
                  setIsProfileMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2 cursor-pointer"
              >
                <Sliders className="h-3.5 w-3.5 text-emerald-600" />
                <span>Slack Alert Integration</span>
              </button>
              <a
                href="/admin/queues"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-3.5 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center justify-between"
              >
                <span className="flex items-center gap-2">
                  <RotateCw className="h-3.5 w-3.5 text-indigo-600" />
                  <span>BullMQ Live Queues</span>
                </span>
                <ExternalLink className="h-3 w-3 text-gray-400" />
              </a>
              <button
                onClick={handleClearEmails}
                className="w-full px-3.5 py-2 text-left text-amber-700 hover:bg-amber-50 flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 text-amber-600" />
                <span>Clear Demo Emails</span>
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={logout}
                className="w-full px-3.5 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>

        {/* Compose Button (Outline green pill) */}
        <button
          onClick={() => {
            setSelectedEmail(null);
            setCurrentView('compose');
          }}
          className="w-full border-2 border-[#00A854] text-[#00A854] hover:bg-[#E8F7F0] font-medium text-xs py-2 px-4 rounded-full text-center transition cursor-pointer flex items-center justify-center select-none"
        >
          Compose
        </button>

        {/* CORE Section */}
        <div className="mt-5">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-1.5 select-none">
            CORE
          </p>

          <nav className="space-y-1">
            {/* Scheduled Tab */}
            <button
              onClick={() => {
                setActiveTab('scheduled');
                setSelectedEmail(null);
                setSearchQuery('');
                setSearchResults(null);
                setCurrentView('list');
              }}
              className={`w-full px-3 py-2 rounded-xl flex items-center justify-between text-xs transition cursor-pointer select-none ${
                activeTab === 'scheduled'
                  ? 'bg-[#E8F7F0] text-gray-900 font-bold'
                  : 'text-gray-600 hover:bg-gray-50 font-normal'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Clock className="h-3.5 w-3.5 text-gray-500" />
                <span>Scheduled</span>
              </div>
              <span className="text-[11px] text-gray-400 font-medium">
                {scheduledTotal}
              </span>
            </button>

            {/* Sent Tab */}
            <button
              onClick={() => {
                setActiveTab('sent');
                setSelectedEmail(null);
                setSearchQuery('');
                setSearchResults(null);
                setCurrentView('list');
              }}
              className={`w-full px-3 py-2 rounded-xl flex items-center justify-between text-xs transition cursor-pointer select-none ${
                activeTab === 'sent'
                  ? 'bg-[#E8F7F0] text-gray-900 font-bold'
                  : 'text-gray-600 hover:bg-gray-50 font-normal'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Send className="h-3.5 w-3.5 text-gray-500" />
                <span>Sent</span>
              </div>
              <span className="text-[11px] text-gray-400 font-medium">
                {sentTotal}
              </span>
            </button>
          </nav>
        </div>
      </aside>

      {/* 2. Main Area (Right) */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        <div className="flex-1 flex flex-col">
          {/* Top Bar with Search, Filter & Refresh */}
          <div className="px-6 py-3.5 border-b border-gray-100 flex items-center gap-3">
            <div className="bg-[#F4F5F7] px-3.5 py-1.5 rounded-full flex items-center gap-2 flex-1 max-w-xl">
              <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search"
                className="bg-transparent border-none text-xs text-gray-800 placeholder-gray-400 focus:outline-none w-full"
              />
            </div>

            <button
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-50 transition cursor-pointer"
              title="Filter emails"
            >
              <Filter className="h-4 w-4" />
            </button>

            <button
              onClick={handleManualRefresh}
              disabled={loading}
              className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-50 transition cursor-pointer"
              title="Refresh emails"
            >
              <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
            </button>

            {searchResults && (
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
                Provider: {searchResults.provider}
              </span>
            )}
          </div>

          {/* Email Rows List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {currentList.map((job) => {
              const recipientDisplay = job.recipientEmail.includes('@')
                ? job.recipientEmail.split('@')[0]
                : job.recipientEmail;

              const formattedScheduledTime = format(
                new Date(job.scheduledAt),
                'EEE h:mm:ss a'
              );

              return (
                <div
                  key={job.id}
                  onClick={() => {
                    setSelectedEmail(job);
                    setCurrentView('detail');
                  }}
                  className="group px-6 py-3.5 hover:bg-[#F9FAFB] flex items-center justify-between cursor-pointer transition select-none"
                >
                  {/* Left details */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1 mr-4">
                    {/* Recipient */}
                    <span className="text-xs font-bold text-gray-900 shrink-0 min-w-[130px] truncate">
                      To: {recipientDisplay}
                    </span>

                    {/* Pill Badge */}
                    {job.status === 'SENT' ? (
                      <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 shrink-0">
                        <Send className="h-3 w-3" />
                        <span>Sent</span>
                      </span>
                    ) : job.status === 'FAILED' ? (
                      <span
                        className="bg-red-50 text-red-700 border border-red-100 px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 shrink-0"
                        title={job.failureReason ? `Failed: ${job.failureReason}` : 'Email failed to send'}
                      >
                        <span>Failed to send</span>
                      </span>
                    ) : job.status === 'PROCESSING' ? (
                      <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 shrink-0">
                        <RotateCw className="h-3 w-3 animate-spin" />
                        <span>Processing</span>
                      </span>
                    ) : job.status === 'RATE_LIMITED_RESCHEDULED' ? (
                      <span
                        className="bg-purple-50 text-purple-700 border border-purple-100 px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 shrink-0"
                        title="Rescheduled due to rate limits"
                      >
                        <Clock className="h-3 w-3" />
                        <span>Rescheduled</span>
                      </span>
                    ) : (
                      <span className="bg-[#FFF3E8] text-[#D97706] border border-amber-100 px-2.5 py-0.5 rounded-full text-[11px] font-medium flex items-center gap-1 shrink-0">
                        <Clock className="h-3 w-3" />
                        <span>{formattedScheduledTime}</span>
                      </span>
                    )}

                    {/* Subject and snippet */}
                    <div className="text-xs truncate text-gray-800">
                      <span className="font-semibold text-gray-900">{job.subject}</span>
                      <span className="text-gray-400 font-normal">
                        {' '}
                        - {job.body.slice(0, 80)}...
                      </span>
                    </div>
                  </div>

                  {/* Right action */}
                  <div className="shrink-0 flex items-center gap-3 text-gray-300">
                    <Star className="h-3.5 w-3.5 group-hover:text-gray-400 hover:!text-amber-400 transition" />
                  </div>
                </div>
              );
            })}

            {currentList.length === 0 && (
              <div className="py-20 text-center text-xs text-gray-400">
                No emails in this view. Click &ldquo;Compose&rdquo; to schedule a campaign.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Slack Integration Modal */}
      <SlackModal
        isOpen={isSlackOpen}
        onClose={() => setIsSlackOpen(false)}
      />

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};
