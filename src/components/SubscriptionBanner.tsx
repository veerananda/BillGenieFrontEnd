import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Linking } from 'react-native';
import { apiClient } from '../services/api';

interface SubscriptionData {
  subscription_end: string;
  days_remaining: number;
  is_expired: boolean;
}

export const SubscriptionBanner: React.FC = () => {
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [showExpiredModal, setShowExpiredModal] = useState(false);

  useEffect(() => {
    loadSubscriptionStatus();
  }, []);

  const loadSubscriptionStatus = async () => {
    try {
      const profile = await apiClient.getRestaurantProfile();
      if (profile && (profile as any).subscription_end) {
        const subscriptionEnd = new Date((profile as any).subscription_end);
        const now = new Date();
        const daysRemaining = Math.ceil((subscriptionEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const isExpired = now > subscriptionEnd;

        const data: SubscriptionData = {
          subscription_end: (profile as any).subscription_end,
          days_remaining: daysRemaining,
          is_expired: isExpired,
        };

        setSubscription(data);

        // Show modal if expired
        if (isExpired) {
          setShowExpiredModal(true);
        }
      }
    } catch (error) {
      console.error('Error loading subscription status:', error);
    }
  };

  const handleContactSupport = () => {
    // Open WhatsApp or email for support
    const message = encodeURIComponent('I want to renew my BillGenie subscription');
    Linking.openURL(`whatsapp://send?phone=919876543210&text=${message}`).catch(() => {
      // Fallback to email
      Linking.openURL(`mailto:support@billgenie.app?subject=Subscription Renewal&body=${message}`);
    });
  };

  if (!subscription) {
    return null;
  }

  // Warning banner for expiring/expired trial
  if (subscription.days_remaining <= 7 || subscription.is_expired) {
    return (
      <>
        <View style={[
          styles.banner,
          subscription.is_expired ? styles.bannerExpired : styles.bannerWarning
        ]}>
          <View style={styles.bannerContent}>
            <Text style={styles.bannerIcon}>
              {subscription.is_expired ? '🚫' : '⚠️'}
            </Text>
            <View style={styles.bannerTextContainer}>
              <Text style={styles.bannerTitle}>
                {subscription.is_expired
                  ? 'Subscription Expired'
                  : `Trial ending in ${subscription.days_remaining} day${subscription.days_remaining === 1 ? '' : 's'}`
                }
              </Text>
              <Text style={styles.bannerSubtitle}>
                {subscription.is_expired
                  ? 'Renew now to continue using BillGenie'
                  : 'Renew your subscription to continue uninterrupted service'
                }
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.renewButton}
            onPress={handleContactSupport}
          >
            <Text style={styles.renewButtonText}>Renew Now</Text>
          </TouchableOpacity>
        </View>

        {/* Expired Modal */}
        <Modal
          visible={showExpiredModal}
          transparent
          animationType="fade"
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalIcon}>⏰</Text>
              <Text style={styles.modalTitle}>Subscription Expired</Text>
              <Text style={styles.modalMessage}>
                Your 30-day free trial has ended. Renew your subscription to continue using BillGenie's powerful restaurant management features.
              </Text>
              <Text style={styles.modalPrice}>₹499/month</Text>
              <Text style={styles.modalFeatures}>
                • Unlimited Orders{'\n'}
                • Real-time Sync{'\n'}
                • 1 Admin + 1 Manager + 3 Staff{'\n'}
                • Kitchen Display{'\n'}
                • Sales Reports
              </Text>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => {
                  setShowExpiredModal(false);
                  handleContactSupport();
                }}
              >
                <Text style={styles.modalButtonText}>Contact Support to Renew</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowExpiredModal(false)}
              >
                <Text style={styles.modalCloseText}>I'll do it later</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </>
    );
  }

  // Info banner for active trial
  return (
    <View style={styles.bannerInfo}>
      <Text style={styles.bannerInfoIcon}>✨</Text>
      <Text style={styles.bannerInfoText}>
        {subscription.days_remaining} days left in your free trial
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    padding: 16,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  bannerWarning: {
    backgroundColor: '#FFF3CD',
  },
  bannerExpired: {
    backgroundColor: '#F8D7DA',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  bannerIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  bannerSubtitle: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  renewButton: {
    backgroundColor: '#4A90E2',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
  },
  renewButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  bannerInfo: {
    backgroundColor: '#E3F2FD',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerInfoIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  bannerInfoText: {
    fontSize: 14,
    color: '#1976D2',
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 30,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  modalPrice: {
    fontSize: 32,
    fontWeight: '700',
    color: '#4A90E2',
    marginBottom: 20,
  },
  modalFeatures: {
    fontSize: 14,
    color: '#555',
    lineHeight: 24,
    marginBottom: 24,
    textAlign: 'left',
  },
  modalButton: {
    backgroundColor: '#4A90E2',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalCloseButton: {
    paddingVertical: 12,
  },
  modalCloseText: {
    color: '#999',
    fontSize: 14,
    textDecoration: 'underline',
  },
});
