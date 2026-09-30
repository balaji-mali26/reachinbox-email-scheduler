import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Mail,
  Search,
  LogOut,
  Slack,
  ExternalLink,
  Layers,
  CheckCircle2,
  X,
} from 'lucide-react';

interface HeaderProps {
  onSearch: (query: string) => void;
  searchQuery: string;
  onOpenSlackModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onSearch,
  searchQuery,
  onOpenSlackModal,
}) => {
  const { user, logout } = useAuth();
  const [searchInput, setSearchInput] = useState(searchQuery);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(searchInput);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    onSearch('');
  };

  const slackConnected = !!user?.slackConnection?.channelId;

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-100">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <span className="text-lg font-bold text-gray-900 tracking-tight flex items-center gap-1.5">
                ReachInbox <span className="text-indigo-600 font-semibold text-sm px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-100">Outbox</span>
              </span>
            </div>
          </div>

          {/* Search Bar (Elasticsearch) */}
          <form
            onSubmit={handleSearchSubmit}
            className="flex-1 max-w-md hidden md:flex items-center relative"
          >
            <Search className="absolute left-3.5 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search emails by recipient, subject, or body..."
              className="w-full pl-10 pr-9 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all bg-gray-50/70 focus:bg-white"
            />
            {searchInput && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 p-0.5 text-gray-400 hover:text-gray-600 rounded-full"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </form>

          {/* Action Links & Profile */}
          <div className="flex items-center gap-3">
            {/* BullMQ Dashboard Link */}
            <a
              href="/admin/queues"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-indigo-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-indigo-200 hover:bg-indigo-50/50 transition-colors"
              title="Open Live BullMQ Queue Monitoring Dashboard"
            >
              <Layers className="h-3.5 w-3.5 text-indigo-500" />
              <span>Queue Metrics</span>
              <ExternalLink className="h-3 w-3 text-gray-400" />
            </a>

            {/* Slack Connection Button */}
            <button
              onClick={onOpenSlackModal}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${
                slackConnected
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:text-indigo-600'
              }`}
            >
              <Slack className="h-3.5 w-3.5 text-[#E01E5A]" />
              {slackConnected ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  <span>Slack Connected</span>
                </>
              ) : (
                <span>Connect Slack</span>
              )}
            </button>

            {/* User Profile / Logout */}
            {user && (
              <div className="flex items-center gap-3 pl-2 border-l border-gray-200">
                <div className="flex items-center gap-2">
                  {user.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.name || user.email}
                      className="h-8 w-8 rounded-full border border-gray-200 object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-indigo-600 text-white font-medium text-xs flex items-center justify-center">
                      {(user.name || user.email)[0].toUpperCase()}
                    </div>
                  )}
                  <div className="hidden lg:block text-left">
                    <p className="text-xs font-semibold text-gray-800 leading-tight">
                      {user.name || 'User'}
                    </p>
                    <p className="text-[11px] text-gray-500 leading-tight truncate max-w-[140px]">
                      {user.email}
                    </p>
                  </div>
                </div>

                <button
                  onClick={logout}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Sign Out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
