import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { Sender, ParseLeadsResponse } from '../types';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  ChevronDown,
  Upload,
  Undo,
  Redo,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  List,
  ListOrdered,
  Quote,
  Code,
  X,
  CheckCircle2,
  AlertCircle,
  RotateCw,
} from 'lucide-react';

interface ComposeEmailViewProps {
  onBack: () => void;
  onSuccess: (message?: string) => void;
  defaultSenderEmail?: string;
}

function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatPresetTimeLabel(date: Date): string {
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}

export const ComposeEmailView: React.FC<ComposeEmailViewProps> = ({
  onBack,
  onSuccess,
  defaultSenderEmail,
}) => {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');
  const [isSenderDropdownOpen, setIsSenderDropdownOpen] = useState(false);

  // Form Fields
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delaySeconds, setDelaySeconds] = useState<number>(2);
  const [hourlyLimit, setHourlyLimit] = useState<number>(100);

  // "Send Later" Popover State
  const [isSendLaterOpen, setIsSendLaterOpen] = useState(false);
  const [scheduledDateTime, setScheduledDateTime] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return toLocalDatetimeInput(d);
  });

  // Loading & Error
  const [submitting, setSubmitting] = useState(false);
  const [parsingLeads, setParsingLeads] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadFeedback, setUploadFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load senders
  useEffect(() => {
    loadSenders();
  }, []);

  const loadSenders = async () => {
    try {
      const res = await api.get('/emails/senders/list');
      const list: Sender[] = res.data.data;
      setSenders(list);
      if (list.length > 0) {
        setSelectedSenderId(list[0].id);
        setHourlyLimit(list[0].hourlyLimit);
      }
    } catch (_err) {
      // Ignore
    }
  };

  const handleAddRecipient = (val: string) => {
    const cleaned = val.trim().toLowerCase();
    if (cleaned && !recipients.includes(cleaned)) {
      setRecipients([...recipients, cleaned]);
      setRecipientInput('');
    }
  };

  const handleRemoveRecipient = (indexToRemove: number) => {
    setRecipients(recipients.filter((_, idx) => idx !== indexToRemove));
  };

  const handleKeyDownRecipient = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddRecipient(recipientInput);
    } else if (e.key === 'Backspace' && !recipientInput && recipients.length > 0) {
      handleRemoveRecipient(recipients.length - 1);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsingLeads(true);
    setErrorMessage(null);
    setUploadFeedback(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = ((event.target?.result as string) || '').trim();
      if (!text) {
        setUploadFeedback({
          type: 'error',
          message: 'The uploaded file is empty. Please upload a valid CSV or TXT file containing email addresses.',
        });
        setParsingLeads(false);
        if (e.target) e.target.value = '';
        return;
      }

      try {
        const res = await api.post('/emails/leads/parse', { content: text });
        const data: ParseLeadsResponse = res.data.data;

        if (!data || data.validCount === 0) {
          setUploadFeedback({
            type: 'error',
            message: 'Invalid CSV: No valid email addresses found. Please ensure the file contains valid emails in CSV format (e.g. "email" header) or one per line.',
          });
        } else {
          const merged = Array.from(new Set([...recipients, ...data.validEmails]));
          setRecipients(merged);

          const notes: string[] = [];
          if (data.duplicateCount > 0) {
            notes.push(`${data.duplicateCount} duplicate${data.duplicateCount > 1 ? 's' : ''} removed`);
          }
          if (data.invalidRows && data.invalidRows.length > 0) {
            notes.push(`${data.invalidRows.length} invalid email${data.invalidRows.length > 1 ? 's' : ''} skipped`);
          }

          const detailsStr = notes.length > 0 ? ` (${notes.join(', ')})` : '';
          setUploadFeedback({
            type: notes.length > 0 ? 'warning' : 'success',
            message: `${data.validCount} recipient${data.validCount > 1 ? 's' : ''} loaded successfully.${detailsStr}`,
          });
        }
      } catch (err: any) {
        const errorText = err.response?.data?.error?.message || err.message || 'Failed to parse file';
        setUploadFeedback({
          type: 'error',
          message: `Upload failed: ${errorText}`,
        });
      } finally {
        setParsingLeads(false);
        if (e.target) {
          e.target.value = '';
        }
      }
    };

    reader.onerror = () => {
      setParsingLeads(false);
      setUploadFeedback({
        type: 'error',
        message: 'Could not read file from disk. Please verify file permissions and try again.',
      });
      if (e.target) {
        e.target.value = '';
      }
    };

    reader.readAsText(file);
  };

  const handleSelectPresetMinutes = (minutesFromNow: number) => {
    const target = new Date();
    target.setMinutes(target.getMinutes() + minutesFromNow);
    setScheduledDateTime(toLocalDatetimeInput(target));
  };

  const handleSelectPresetTomorrow = () => {
    const target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    setScheduledDateTime(toLocalDatetimeInput(target));
  };

  const handleSubmit = async (sendNow = false) => {
    setErrorMessage(null);

    let finalRecipients = [...recipients];
    if (recipientInput.trim()) {
      const extra = recipientInput.trim().toLowerCase();
      if (!finalRecipients.includes(extra)) {
        finalRecipients.push(extra);
      }
    }

    if (finalRecipients.length === 0) {
      setErrorMessage('Please enter at least one recipient email address.');
      return;
    }

    if (!subject.trim()) {
      setErrorMessage('Please enter an email subject line.');
      return;
    }

    if (!body.trim()) {
      setErrorMessage('Please enter an email body.');
      return;
    }

    const scheduledDate = new Date(scheduledDateTime);
    if (!sendNow && scheduledDate.getTime() <= Date.now()) {
      setErrorMessage('Scheduled time must be in the future. Please pick a future date and time or click "Send Now".');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/emails/schedule', {
        senderId: selectedSenderId || undefined,
        subject: subject.trim(),
        body: body.trim(),
        startAt: sendNow ? new Date().toISOString() : scheduledDate.toISOString(),
        sendNow,
        minDelayMs: (delaySeconds || 2) * 1000,
        hourlyLimit: hourlyLimit || 100,
        recipients: finalRecipients,
      });

      const count = finalRecipients.length;
      const countMsg = `${count} email${count > 1 ? 's' : ''}`;
      const successText = sendNow
        ? `${countMsg} queued for immediate delivery.`
        : `${countMsg} scheduled successfully.`;

      onSuccess(successText);
      onBack();
    } catch (err: any) {
      setErrorMessage(err.response?.data?.error?.message || err.message || 'Failed to schedule campaign');
    } finally {
      setSubmitting(false);
    }
  };

  const activeSender = senders.find((s) => s.id === selectedSenderId);
  const senderEmailDisplay = activeSender?.email || defaultSenderEmail;

  return (
    <div className="flex-1 flex flex-col bg-white min-h-screen relative font-sans">
      {/* 1. Top Bar */}
      <div className="px-6 py-3.5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1 text-gray-700 hover:text-gray-900 rounded-md hover:bg-gray-100 transition cursor-pointer"
            title="Back to inbox"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h2 className="text-sm font-semibold text-gray-900">
            Compose New Email
          </h2>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-3 relative">
          <button
            className="p-1.5 text-gray-400 hover:text-gray-600 transition cursor-pointer"
            title="Attach File"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <button
            onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition cursor-pointer"
            title="Schedule Options"
          >
            <Clock className="h-4 w-4" />
          </button>

          {/* Send Now Button */}
          <button
            onClick={() => handleSubmit(true)}
            disabled={submitting}
            className="bg-[#00A854] hover:bg-[#009249] text-white px-4 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
          >
            {submitting ? (
              <>
                <RotateCw className="h-3 w-3 animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              'Send Now'
            )}
          </button>

          {/* Send Later pill button */}
          <button
            onClick={() => setIsSendLaterOpen(!isSendLaterOpen)}
            disabled={submitting}
            className="border border-[#00A854] text-[#00A854] hover:bg-[#E8F7F0] px-4 py-1.5 rounded-full text-xs font-medium transition cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <RotateCw className="h-3.5 w-3.5 animate-spin" />
                <span>Scheduling...</span>
              </>
            ) : (
              <>
                <Clock className="h-3.5 w-3.5" />
                <span>Send Later</span>
              </>
            )}
          </button>

          {/* Send Later Floating Card */}
          {isSendLaterOpen && (
            <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 p-4 z-40">
              <h3 className="text-xs font-bold text-gray-900 mb-3">Schedule Send Later</h3>

              {/* Date & Time Picker */}
              <div className="relative mb-3">
                <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Select Date & Time (Local Time)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledDateTime}
                  min={toLocalDatetimeInput(new Date())}
                  onChange={(e) => setScheduledDateTime(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 focus:outline-none focus:border-emerald-500 bg-white"
                />
              </div>

              {/* Dynamic Preset Shortcuts */}
              <div className="divide-y divide-gray-50 text-xs text-gray-700 mb-4">
                <button
                  type="button"
                  onClick={() => handleSelectPresetMinutes(5)}
                  className="w-full text-left py-2 hover:text-emerald-700 cursor-pointer flex items-center justify-between"
                >
                  <span className="font-medium text-emerald-800">In 5 minutes</span>
                  <span className="text-[11px] text-gray-400">
                    {formatPresetTimeLabel(new Date(Date.now() + 5 * 60 * 1000))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectPresetMinutes(15)}
                  className="w-full text-left py-2 hover:text-emerald-700 cursor-pointer flex items-center justify-between"
                >
                  <span>In 15 minutes</span>
                  <span className="text-[11px] text-gray-400">
                    {formatPresetTimeLabel(new Date(Date.now() + 15 * 60 * 1000))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectPresetMinutes(30)}
                  className="w-full text-left py-2 hover:text-emerald-700 cursor-pointer flex items-center justify-between"
                >
                  <span>In 30 minutes</span>
                  <span className="text-[11px] text-gray-400">
                    {formatPresetTimeLabel(new Date(Date.now() + 30 * 60 * 1000))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectPresetMinutes(60)}
                  className="w-full text-left py-2 hover:text-emerald-700 cursor-pointer flex items-center justify-between"
                >
                  <span>In 1 hour</span>
                  <span className="text-[11px] text-gray-400">
                    {formatPresetTimeLabel(new Date(Date.now() + 60 * 60 * 1000))}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleSelectPresetTomorrow}
                  className="w-full text-left py-2 hover:text-emerald-700 cursor-pointer flex items-center justify-between"
                >
                  <span>Tomorrow morning</span>
                  <span className="text-[11px] text-gray-400">9:00 AM</span>
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsSendLaterOpen(false)}
                  className="px-3 py-1 text-xs text-gray-500 hover:text-gray-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setIsSendLaterOpen(false);
                    handleSubmit(false);
                  }}
                  className="border border-[#00A854] text-[#00A854] hover:bg-[#E8F7F0] px-3.5 py-1 rounded-full text-xs font-semibold cursor-pointer disabled:opacity-50 flex items-center gap-1"
                >
                  {submitting && <RotateCw className="h-3 w-3 animate-spin" />}
                  <span>{submitting ? 'Scheduling...' : 'Confirm Schedule'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="mx-6 mt-3 p-3 rounded-xl bg-red-50 text-red-600 text-xs flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 2. Main Form Fields Area */}
      <div className="flex-1 px-8 py-5 max-w-4xl w-full flex flex-col space-y-3.5">
        {/* Row 1: From */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 w-14 shrink-0 font-medium">From</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsSenderDropdownOpen(!isSenderDropdownOpen)}
              className="bg-[#F4F5F7] hover:bg-[#EBEDF0] px-3 py-1.5 rounded-lg text-xs font-medium text-gray-800 inline-flex items-center gap-2 cursor-pointer transition"
            >
              <span>{senderEmailDisplay}</span>
              <ChevronDown className="h-3 w-3 text-gray-500" />
            </button>

            {isSenderDropdownOpen && senders.length > 0 && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-lg py-1 z-30 min-w-[220px] text-xs">
                {senders.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setSelectedSenderId(s.id);
                      setHourlyLimit(s.hourlyLimit);
                      setIsSenderDropdownOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-gray-50 flex flex-col"
                  >
                    <span className="font-semibold text-gray-900">{s.name}</span>
                    <span className="text-gray-400 text-[11px]">{s.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: To (with chips and Upload List) */}
        <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
          <span className="text-xs text-gray-500 w-14 shrink-0 font-medium">To</span>
          <div className="flex-1 flex flex-wrap items-center gap-1.5">
            {recipients.slice(0, 3).map((r, idx) => (
              <span
                key={idx}
                className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-2.5 py-0.5 text-xs inline-flex items-center gap-1"
              >
                <span>{r}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveRecipient(idx)}
                  className="hover:text-red-500 cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}

            {recipients.length > 3 && (
              <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full px-2 py-0.5 text-xs font-semibold">
                +{recipients.length - 3}
              </span>
            )}

            <input
              type="text"
              value={recipientInput}
              onChange={(e) => setRecipientInput(e.target.value)}
              onKeyDown={handleKeyDownRecipient}
              onBlur={() => {
                if (recipientInput) handleAddRecipient(recipientInput);
              }}
              placeholder={recipients.length === 0 ? 'recipient@example.com' : 'Add more...'}
              className="text-xs text-gray-800 placeholder-gray-400 focus:outline-none flex-1 min-w-[140px]"
            />
          </div>

          {/* Upload List Button */}
          <div className="shrink-0 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsingLeads}
              className="text-xs text-[#00A854] hover:text-[#009249] font-medium flex items-center gap-1.5 cursor-pointer transition select-none disabled:opacity-50"
              title="Upload recipient list (.csv, .txt)"
            >
              {parsingLeads ? (
                <>
                  <RotateCw className="h-3.5 w-3.5 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload List</span>
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Format hint */}
        <div className="flex items-center justify-between text-[11px] text-gray-400 pl-17">
          <span>Enter emails comma/enter-separated, or click &ldquo;Upload List&rdquo;</span>
          <span>Formats supported: .csv, .txt (column header &lsquo;email&rsquo; or 1 per line)</span>
        </div>

        {/* Upload Feedback Banner */}
        {uploadFeedback && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center justify-between border ${
              uploadFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : uploadFeedback.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : 'bg-red-50 border-red-200 text-red-950'
            }`}
          >
            <div className="flex items-center gap-2">
              {uploadFeedback.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
              {uploadFeedback.type === 'warning' && <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />}
              {uploadFeedback.type === 'error' && <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />}
              <span>{uploadFeedback.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setUploadFeedback(null)}
              className="cursor-pointer text-gray-400 hover:text-gray-700 p-0.5"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Row 3: Subject */}
        <div className="flex items-center gap-3 border-b border-gray-100 pb-2">
          <span className="text-xs text-gray-500 w-14 shrink-0 font-medium">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full text-xs text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>

        {/* Row 4: Delay & Hourly Limit */}
        <div className="flex items-center gap-6 pt-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Delay between 2 emails</span>
            <input
              type="number"
              min="0"
              max="3600"
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(parseInt(e.target.value, 10) || 0)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-14 text-center focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Hourly Limit</span>
            <input
              type="number"
              min="1"
              max="10000"
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 1)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs w-14 text-center focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Row 5: Rich Body Container */}
        <div className="flex-1 bg-[#F9FAFB] rounded-2xl p-4 flex flex-col min-h-[320px] border border-gray-100/60 mt-2">
          {/* Formatting Toolbar (Matches screenshot) */}
          <div className="bg-white rounded-xl shadow-xs border border-gray-100 px-3 py-1.5 flex items-center gap-2 text-gray-400 mb-3 flex-wrap text-xs select-none">
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Undo className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Redo className="h-3.5 w-3.5" />
            </button>
            <div className="h-3 w-px bg-gray-200 mx-1" />
            <span className="text-[11px] font-bold text-gray-600 cursor-pointer flex items-center gap-0.5">
              TT <ChevronDown className="h-2.5 w-2.5" />
            </span>
            <div className="h-3 w-px bg-gray-200 mx-1" />
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Underline className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Strikethrough className="h-3.5 w-3.5" />
            </button>
            <div className="h-3 w-px bg-gray-200 mx-1" />
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <AlignLeft className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <List className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <ListOrdered className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Quote className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="hover:text-gray-700 cursor-pointer">
              <Code className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Text Area */}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type your email message here..."
            className="flex-1 bg-transparent border-none focus:outline-none text-xs text-gray-800 placeholder-gray-400 resize-none leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
};
