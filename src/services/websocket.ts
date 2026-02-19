import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { logger } from '../utils/logger';

type WebSocketEventType = 
  | 'connected'
  | 'order_created'
  | 'order_updated'
  | 'order_status_changed'
  | 'inventory_updated'
  | 'menu_updated';

interface WebSocketEvent {
  type: WebSocketEventType;
  room_id: string;
  timestamp: string;
  data: any;
}

type EventCallback = (data: any) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners: Map<WebSocketEventType, EventCallback[]> = new Map();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private isConnecting = false;
  private shouldReconnect = true;

  private getWebSocketUrl(): string {
    // Use environment variable or local backend URL
    const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://192.168.29.196:3000';
    // Convert http/https to ws/wss and remove trailing slash
    const wsUrl = apiUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const isSecure = apiUrl.startsWith('https');
    const protocol = isSecure ? 'wss' : 'ws';
    return `${protocol}://${wsUrl}`;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      logger.websocket('WebSocket already connected or connecting');
      return;
    }

    try {
      this.isConnecting = true;
      this.shouldReconnect = true;

      const token = await AsyncStorage.getItem('auth_token');
      if (!token) {
        logger.error('No auth token found, cannot connect to WebSocket');
        this.isConnecting = false;
        return;
      }

      const url = `${this.getWebSocketUrl()}/ws?token=${token}`;
      logger.websocket(`Connecting to WebSocket: ${url}`);

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        logger.websocket('WebSocket connected');
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.emit('connected', { message: 'Connected to server' });
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketEvent = JSON.parse(event.data);
          logger.websocket(`WebSocket message: ${message.type}`, message.data);
          this.emit(message.type, message.data);
        } catch (error) {
          logger.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        logger.error('WebSocket error:', error);
        this.isConnecting = false;
      };

      this.ws.onclose = (event) => {
        logger.websocket('WebSocket disconnected');
        this.isConnecting = false;
        this.ws = null;

        if (this.shouldReconnect && !event.wasClean) {
          this.attemptReconnect();
        }
      };
    } catch (error) {
      logger.error('Error connecting to WebSocket:', error);
      this.isConnecting = false;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      logger.websocket(`Reconnecting... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      this.reconnectTimeout = setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      logger.error('Max reconnection attempts reached');
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    logger.websocket('WebSocket manually disconnected');
  }

  on(event: WebSocketEventType, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: WebSocketEventType, callback: EventCallback): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: WebSocketEventType, data: any): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          logger.error(`Error in WebSocket event handler for ${event}:`, error);
        }
      });
    }
  }

  send(type: string, data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const message = {
        type,
        data,
        timestamp: new Date().toISOString(),
      };
      this.ws.send(JSON.stringify(message));
      logger.websocket(`WebSocket sent: ${type}`, data);
    } else {
      logger.warn('WebSocket not connected, cannot send message');
    }
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();
