import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import apiClient from '../services/api';

type RootStackParamList = {
  EmailVerification: { restaurantId: string; email: string; restaurantCode: string };
  Login: undefined;
};

type EmailVerificationProps = NativeStackScreenProps<RootStackParamList, 'EmailVerification'>;

export const EmailVerificationScreen: React.FC<EmailVerificationProps> = ({ navigation, route }) => {
  const { restaurantId, email, restaurantCode } = route.params;
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [timer, setTimer] = useState(0);

  // Countdown timer for resend button
  useEffect(() => {
    if (timer > 0) {
      const interval = setInterval(() => {
        setTimer((t) => t - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [timer]);

  const handleResendEmail = async () => {
    try {
      setResending(true);
      await (apiClient as any).makeRequest(
        `/auth/resend-verification?restaurant_id=${restaurantId}&email=${email}`,
        'POST'
      );
      Alert.alert('Success', 'Verification email resent! Check your inbox.');
      setTimer(30); // Disable resend for 30 seconds
    } catch (error: any) {
      Alert.alert('Error', 'Failed to resend verification email');
    } finally {
      setResending(false);
    }
  };

  const handleVerificationDone = () => {
    Alert.alert(
      'Verification Complete',
      'Your email has been verified. You can now login with your restaurant code and password.',
      [
        {
          text: 'Go to Login',
          onPress: () => {
            navigation.navigate('Login');
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>📧</Text>
        <Text style={styles.title}>Verify Your Email</Text>
        <Text style={styles.subtitle}>
          We've sent a verification link to your email address
        </Text>

        <View style={styles.emailBox}>
          <Text style={styles.emailLabel}>Email Address:</Text>
          <Text style={styles.emailValue}>{email}</Text>
        </View>

        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Restaurant Login Code:</Text>
          <Text style={styles.codeValue}>{restaurantCode}</Text>
        </View>

        <View style={styles.instructionBox}>
          <Text style={styles.instructionTitle}>📋 What to do:</Text>
          <Text style={styles.instruction}>
            1. Check your email inbox for the verification link{'\n'}
            2. Click the link to verify your email{'\n'}
            3. Return here and click "I've Verified My Email"
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.verifyButton, loading && styles.disabledButton]}
          onPress={handleVerificationDone}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.verifyButtonText}>✅ I've Verified My Email</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.divider}>OR</Text>

        <TouchableOpacity
          style={[styles.resendButton, (resending || timer > 0) && styles.disabledButton]}
          onPress={handleResendEmail}
          disabled={resending || timer > 0}
        >
          {resending ? (
            <ActivityIndicator size="small" color="#7c3aed" />
          ) : (
            <Text style={styles.resendButtonText}>
              🔄 Resend Email {timer > 0 ? `(${timer}s)` : ''}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.helpBox}>
          <Text style={styles.helpTitle}>💡 Need Help?</Text>
          <Text style={styles.helpText}>
            • Check your spam/junk folder{'\n'}
            • Make sure you entered the correct email address{'\n'}
            • Try resending the verification email
          </Text>
        </View>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={() => {
            Alert.alert('Skip Verification?', 'You won\'t be able to reset your password without email verification.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Skip',
                onPress: () => navigation.navigate('Login'),
                style: 'destructive',
              },
            ]);
          }}
        >
          <Text style={styles.skipButtonText}>← Go Back to Login</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  icon: {
    fontSize: 64,
    textAlign: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  emailBox: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#7c3aed',
  },
  emailLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  emailValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  codeBox: {
    backgroundColor: '#e3f2fd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2196f3',
  },
  codeLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  codeValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1976d2',
    fontFamily: 'monospace',
  },
  instructionBox: {
    backgroundColor: '#fff3cd',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  instructionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#856404',
    marginBottom: 8,
  },
  instruction: {
    fontSize: 13,
    color: '#856404',
    lineHeight: 20,
  },
  verifyButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  verifyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  divider: {
    textAlign: 'center',
    color: '#999',
    marginVertical: 12,
    fontSize: 12,
  },
  resendButton: {
    borderWidth: 2,
    borderColor: '#7c3aed',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  resendButtonText: {
    color: '#7c3aed',
    fontSize: 14,
    fontWeight: 'bold',
  },
  helpBox: {
    backgroundColor: '#e8f5e9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  helpTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#2e7d32',
    marginBottom: 8,
  },
  helpText: {
    fontSize: 12,
    color: '#2e7d32',
    lineHeight: 18,
  },
  skipButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  skipButtonText: {
    color: '#999',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
