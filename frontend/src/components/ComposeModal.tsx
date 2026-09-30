import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Sender, ParseLeadsResponse } from '../types';
import {
  X,
  Upload,
  Clock,
  Send,
  AlertTriangle,
  CheckCircle,
  Sliders,
} from 'lucide-react';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderId, setSelectedSenderId] = useState<string>('');

  const [inputMode, setInputMode] = useState<'direct' | 'upload'>('direct');
  const [directRecipients, setDirectRecipients] = useState('');
  const [fileName, setFileName] = useState('');
  const [leadParseResult, setLeadParseResult] = useState<ParseLeadsResponse | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

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

  // Schedulers & Modes
  const [sendMode, setSendMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [startAt, setStartAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 5);
    return toLocalDatetimeInput(d);
  });
  const [minDelaySeconds, setMinDelaySeconds] = useState(2);
  const [hourlyLimit, setHourlyLimit] = useState(100);

  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadSenders();
      const d = new Date();
      d.setMinutes(d.getMinutes() + 5);
      setStartAt(toLocalDatetimeInput(d));
    }
  }, [isOpen]);

  const loadSenders = async () => {
    try {
      const res = await api.get('/emails/senders/list');
      const list: Sender[] = res.data.data;
      setSenders(list);
      if (list.length > 0 && !selectedSenderId) {
        setSelectedSenderId(list[0].id);
        setHourlyLimit(list[0].hourlyLimit);
      }
    } catch (_err) {
      // Ignore
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParsing(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;

      try {
        const res = await api.post('/emails/leads/parse', { content: text });
        setLeadParseResult(res.data.data);
      } catch (err: any) {
        setError(`Failed to parse leads: ${err.message}`);
      } finally {
        setParsing(false);
      }
    };
    reader.readAsText(file);
  };

  const setPresetMinutes = (mins: number) => {
    const target = new Date();
    target.setMinutes(target.getMinutes() + mins);
    setStartAt(toLocalDatetimeInput(target));
    setSendMode('scheduled');
  };

  const setPresetTomorrowMorning = () => {
    const target = new Date();
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    setStartAt(toLocalDatetimeInput(target));
    setSendMode('scheduled');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Resolve recipients list
    let recipients: string[] = [];
    if (inputMode === 'upload') {
      if (!leadParseResult || leadParseResult.validEmails.length === 0) {
        setError('Please upload a valid CSV or text file containing email addresses.');
        return;
      }
      recipients = leadParseResult.validEmails;
    } else {
      recipients = directRecipients
        .split(/[\n,]+/)
        .map((r) => r.trim().toLowerCase())
        .filter((r) => r.length > 0);

      if (recipients.length === 0) {
        setError('Please enter at least one recipient email address.');
        return;
      }
    }

    if (!selectedSenderId) {
      setError('Please select a sender account.');
      return;
    }

    if (!subject.trim()) {
      setError('Please enter an email subject.');
      return;
    }

    if (!body.trim()) {
      setError('Please enter an email body.');
      return;
    }

    const isSendNow = sendMode === 'immediate';
    const scheduledDate = new Date(startAt);
    if (!isSendNow && scheduledDate.getTime() <= Date.now()) {
      setError('Scheduled time must be in the future. Pick a future date & time or select "Send Immediately".');
      return;
    }

    setLoading(true);

    try {
      await api.post('/emails/schedule', {
        senderId: selectedSenderId,
        subject: subject.trim(),
        body: body.trim(),
        startAt: isSendNow ? new Date().toISOString() : scheduledDate.toISOString(),
        sendNow: isSendNow,
        minDelayMs: minDelaySeconds * 1000,
        hourlyLimit,
        recipients,
      });

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || 'Failed to schedule campaign');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <Send className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Schedule Email Campaign</h2>
              <p className="text-xs text-gray-500">Configure recipient leads, delay parameters, and send slot controls</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Sender Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
              Sender Account
            </label>
            <select
              value={selectedSenderId}
              onChange={(e) => setSelectedSenderId(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
            >
              {senders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.email}) — Limit: {s.hourlyLimit}/hr
                </option>
              ))}
            </select>
          </div>

          {/* Recipient Input Mode */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Recipients & Leads
              </label>
              <div className="inline-flex rounded-lg p-0.5 bg-gray-100 text-xs">
                <button
                  type="button"
                  onClick={() => setInputMode('direct')}
                  className={`px-3 py-1 rounded-md font-medium transition-all ${
                    inputMode === 'direct'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Direct Input
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode('upload')}
                  className={`px-3 py-1 rounded-md font-medium transition-all ${
                    inputMode === 'upload'
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Upload CSV / Leads
                </button>
              </div>
            </div>

            {inputMode === 'direct' ? (
              <div>
                <textarea
                  rows={3}
                  value={directRecipients}
                  onChange={(e) => setDirectRecipients(e.target.value)}
                  placeholder="Enter recipient email addresses (comma or newline separated)...&#10;alice@acme.com, bob@corp.test"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-xs"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <label className="border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-colors bg-gray-50/50 hover:bg-indigo-50/20">
                  <Upload className="h-7 w-7 text-indigo-500 mb-2" />
                  <span className="text-sm font-semibold text-gray-800">
                    {fileName || 'Drop CSV or TXT lead file here, or browse'}
                  </span>
                  <span className="text-xs text-gray-500 mt-1">
                    Accepts comma-separated or plain text lists
                  </span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                {parsing && (
                  <p className="text-xs text-indigo-600 animate-pulse text-center">
                    Parsing leads and validating email addresses...
                  </p>
                )}

                {leadParseResult && (
                  <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-xs grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-gray-500">Total Rows</p>
                      <p className="text-sm font-bold text-gray-800">{leadParseResult.totalRows}</p>
                    </div>
                    <div>
                      <p className="text-emerald-600 flex items-center justify-center gap-1">
                        <CheckCircle className="h-3 w-3" /> Valid Emails
                      </p>
                      <p className="text-sm font-bold text-emerald-700">{leadParseResult.validCount}</p>
                    </div>
                    <div>
                      <p className="text-amber-600">Duplicates Removed</p>
                      <p className="text-sm font-bold text-amber-700">{leadParseResult.duplicateCount}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Subject Line */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
              Subject Line
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Quick question regarding Outbox scheduling"
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Email Body */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
              Email Body
            </label>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi there,&#10;&#10;I wanted to follow up on our previous discussion..."
              className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Schedulers & Distributed Rate Limits */}
          <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-900 font-semibold text-xs uppercase tracking-wider">
                <Sliders className="h-4 w-4 text-indigo-600" />
                <span>Delivery & Schedule Options</span>
              </div>

              {/* Mode Toggle */}
              <div className="flex items-center bg-white p-0.5 rounded-lg border border-indigo-200 text-xs">
                <button
                  type="button"
                  onClick={() => setSendMode('immediate')}
                  className={`px-3 py-1 rounded-md transition font-medium cursor-pointer ${
                    sendMode === 'immediate'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Send Immediately
                </button>
                <button
                  type="button"
                  onClick={() => setSendMode('scheduled')}
                  className={`px-3 py-1 rounded-md transition font-medium cursor-pointer ${
                    sendMode === 'scheduled'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Schedule for Later
                </button>
              </div>
            </div>

            {sendMode === 'scheduled' && (
              <div className="space-y-3 bg-white p-3.5 rounded-xl border border-indigo-100">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-gray-700">
                    Schedule Date & Time (Local Time)
                  </label>
                  <span className="text-[11px] text-gray-500 font-mono">
                    {formatPresetTimeLabel(new Date(startAt))}
                  </span>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPresetMinutes(5)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition cursor-pointer"
                  >
                    +5 min
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetMinutes(15)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition cursor-pointer"
                  >
                    +15 min
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetMinutes(30)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition cursor-pointer"
                  >
                    +30 min
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetMinutes(60)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition cursor-pointer"
                  >
                    +1 hour
                  </button>
                  <button
                    type="button"
                    onClick={setPresetTomorrowMorning}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition cursor-pointer"
                  >
                    Tomorrow 9 AM
                  </button>
                </div>

                <input
                  type="datetime-local"
                  value={startAt}
                  min={toLocalDatetimeInput(new Date())}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-xs focus:ring-2 focus:ring-emerald-500 bg-white"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Delay between emails */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Min Delay Between Emails (seconds)
                </label>
                <input
                  type="number"
                  min="0"
                  max="3600"
                  value={minDelaySeconds}
                  onChange={(e) => setMinDelaySeconds(parseInt(e.target.value, 10) || 0)}
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>

              {/* Hourly Quota */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Hourly Rate Limit
                </label>
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={hourlyLimit}
                  onChange={(e) => setHourlyLimit(parseInt(e.target.value, 10) || 1)}
                  className="w-full px-3 py-1.5 rounded-lg border border-gray-300 text-xs focus:ring-2 focus:ring-indigo-500 bg-white"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500 leading-normal">
              BullMQ processes deliveries respecting your {minDelaySeconds}s delay constraint. Sends exceeding {hourlyLimit}/hour automatically reschedule to the next window.
            </p>
          </div>
        </form>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || parsing}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-[#00A854] hover:bg-[#009249] shadow-md shadow-emerald-100 disabled:opacity-50 transition-all cursor-pointer"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{sendMode === 'immediate' ? 'Sending...' : 'Scheduling...'}</span>
              </>
            ) : sendMode === 'immediate' ? (
              <>
                <Send className="h-4 w-4" />
                <span>Send Immediately</span>
              </>
            ) : (
              <>
                <Clock className="h-4 w-4" />
                <span>Schedule Campaign</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
