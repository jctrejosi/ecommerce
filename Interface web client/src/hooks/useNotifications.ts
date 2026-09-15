import { io, Socket } from 'socket.io-client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { getAuthHeaders } from '../services/customer-auth.service';

const SOCKET_URL = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3000'));

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  linkUrl?: string;
  createdAt: string;
}

export function useNotifications(customerId: number | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  // Connect to socket
  useEffect(() => {
    if (!customerId) return;

    const socket = io(`${SOCKET_URL}/notifications`, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('subscribe:customer', customerId);
    });

    socket.on('notification:new', (notification: AppNotification) => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
    });

    return () => {
      socket.disconnect();
    };
  }, [customerId]);

  // Load existing notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const API = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3000'));
      const res = await fetch(`${API}/notifications`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        setUnreadCount(data.filter((n: AppNotification) => !n.isRead).length);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (customerId) fetchNotifications();
  }, [customerId, fetchNotifications]);

  const markAsRead = useCallback(async (id: number) => {
    const API = (import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : 'http://localhost:3000'));
    await fetch(`${API}/notifications/${id}/read`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
    });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
    setUnreadCount(prev => Math.max(0, prev - 1));
  }, []);

  return { notifications, unreadCount, markAsRead };
}
