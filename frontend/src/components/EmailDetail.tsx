import React from 'react';
import { EmailJob } from '../types';
import {
  ArrowLeft,
  Star,
  Archive,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { format } from 'date-fns';

interface EmailDetailProps {
  email: EmailJob;
  onBack: () => void;
  userAvatar?: string | null;
}

export const EmailDetail: React.FC<EmailDetailProps> = ({
  email,
  onBack,
  userAvatar,
}) => {
  const senderName = email.sender?.name || 'Sender';
  const senderEmail = email.sender?.email || '';
  const initial = (senderName.charAt(0) || 'S').toUpperCase();

  const formattedDate = email.sentAt
    ? format(new Date(email.sentAt), 'MMM d, yyyy h:mm a')
    : email.scheduledAt
    ? format(new Date(email.scheduledAt), 'MMM d, yyyy h:mm a')
    : '';

  return (
    <div className="flex-1 flex flex-col bg-white min-h-screen">
      {/* Top action bar */}
      <div className="px-6 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 text-gray-600 hover:text-gray-900 rounded-md hover:bg-gray-100 transition cursor-pointer"
            title="Back to list"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold text-gray-900 truncate max-w-xl">
            {email.subject}
          </h2>
        </div>

        <div className="flex items-center gap-3 text-gray-400">
          <button className="hover:text-amber-400 transition cursor-pointer" title="Star">
            <Star className="h-4 w-4" />
          </button>
          <button className="hover:text-gray-700 transition cursor-pointer" title="Archive">
            <Archive className="h-4 w-4" />
          </button>
          <button className="hover:text-red-500 transition cursor-pointer" title="Delete">
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="h-4 w-px bg-gray-200 mx-1" />
          <div className="h-7 w-7 rounded-full overflow-hidden bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-xs select-none">
            {userAvatar ? (
              <img
                src={userAvatar}
                alt="User"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span>U</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Email View */}
      <div className="flex-1 px-8 py-6 max-w-4xl w-full">
        {/* Sender Info Row */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-[#00A854] text-white flex items-center justify-center font-bold text-sm shrink-0">
              {initial}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-900">{senderName}</span>
                {senderEmail && <span className="text-xs text-gray-400">&lt;{senderEmail}&gt;</span>}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                <span>To: {email.recipientEmail}</span>
              </div>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-400 font-medium">{formattedDate}</div>
            <span
              className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${
                email.status === 'SENT'
                  ? 'bg-emerald-50 text-emerald-700'
                  : email.status === 'FAILED'
                  ? 'bg-red-50 text-red-700'
                  : email.status === 'PROCESSING'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
            >
              {email.status === 'FAILED'
                ? 'Failed to send'
                : email.status === 'RATE_LIMITED_RESCHEDULED'
                ? 'Rescheduled (Rate Limit)'
                : email.status}
            </span>
          </div>
        </div>

        {/* Real Ethereal Link banner if present */}
        {email.etherealPreviewUrl && (
          <div className="mb-6 p-3.5 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-between">
            <div className="text-xs text-emerald-800">
              <span className="font-semibold">Live Ethereal SMTP Delivery:</span> Real email was dispatched to Ethereal.
              {email.etherealMessageId && (
                <div className="text-[10px] text-emerald-600 mt-0.5 font-mono truncate max-w-md">
                  Message ID: {email.etherealMessageId}
                </div>
              )}
            </div>
            <a
              href={email.etherealPreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-[#00A854] hover:bg-[#009249] transition shadow-xs shrink-0"
            >
              <span>View in Ethereal Mail</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {/* Failure message if failed */}
        {email.status === 'FAILED' && email.failureReason && (
          <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
            <span className="font-semibold">Delivery Failure:</span> {email.failureReason}
          </div>
        )}

        {/* Real Email Body Content */}
        <div className="text-xs leading-relaxed text-gray-800 space-y-4 pt-2">
          <div className="whitespace-pre-line font-normal text-sm text-gray-800">
            {email.body}
          </div>
        </div>
      </div>
    </div>
  );
};
