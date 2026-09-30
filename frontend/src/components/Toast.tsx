import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastProps {
  message: string;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  onClose,
  duration = 5000,
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const bgStyles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-950',
    error: 'bg-red-50 border-red-200 text-red-950',
    info: 'bg-indigo-50 border-indigo-200 text-indigo-950',
  }[type];

  const Icon = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Info,
  }[type];

  const iconColors = {
    success: 'text-emerald-600',
    error: 'text-red-600',
    info: 'text-indigo-600',
  }[type];

  return (
    <div className="fixed bottom-5 right-5 z-50 max-w-sm w-full animate-in fade-in slide-in-from-bottom-3 duration-200">
      <div className={`flex items-start gap-3 p-3.5 rounded-xl border shadow-lg ${bgStyles}`}>
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconColors}`} />
        <div className="flex-1 text-xs font-medium leading-relaxed pr-1">
          {message}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 transition cursor-pointer p-0.5 rounded-md shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
