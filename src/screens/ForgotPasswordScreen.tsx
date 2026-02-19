import React, { useState } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import apiClient from '../services/api';

type RootStackParamList = {
  ForgotPassword: undefined;
  Login: undefined;
  ResetPassword: { token: string };
};

type ForgotPasswordScreenProps = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

export const ForgotPasswordScreen: React.FC<ForgotPasswordScreenProps> = ({ navigation }) => {
    const [identifier, setIdentifier] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const styles = StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: '#ffffff',
        },
        content: {
            flex: 1,
            padding: 20,
            justifyContent: 'center',
        },
        title: {
            textAlign: 'center',
            marginBottom: 16,
            color: '#7c3aed',
            fontSize: 28,
            fontWeight: 'bold',
        },
        subtitle: {
            textAlign: 'center',
            marginBottom: 32,
            color: '#666',
            fontSize: 14,
        },
        warningBox: {
            backgroundColor: '#fff3cd',
            borderLeftWidth: 4,
            borderLeftColor: '#ffc107',
            padding: 12,
            borderRadius: 4,
            marginBottom: 24,
        },
        warningTitle: {
            color: '#856404',
            fontWeight: 'bold',
            marginBottom: 8,
            fontSize: 14,
        },
        warningText: {
            color: '#856404',
            fontSize: 13,
            lineHeight: 20,
        },
        input: {
            borderWidth: 1,
            borderColor: '#ccc',
            padding: 12,
            marginBottom: 16,
            borderRadius: 4,
            fontSize: 16,
        },
        button: {
            backgroundColor: '#7c3aed',
            padding: 12,
            marginTop: 24,
            borderRadius: 4,
            alignItems: 'center',
        },
        buttonText: {
            color: 'white',
            fontSize: 16,
            fontWeight: 'bold',
        },
        backButton: {
            padding: 12,
            marginTop: 16,
            borderRadius: 4,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: '#7c3aed',
        },
        backButtonText: {
            color: '#7c3aed',
            fontSize: 16,
            fontWeight: 'bold',
        },
        error: {
            color: '#ff0000',
            textAlign: 'center',
            marginTop: 8,
            fontSize: 14,
        },
        success: {
            color: '#00aa00',
            textAlign: 'center',
            marginTop: 8,
            fontSize: 14,
            marginBottom: 16,
        },
        successMessage: {
            color: '#00aa00',
            textAlign: 'center',
            marginTop: 16,
            marginBottom: 16,
            fontSize: 14,
        },
        loadingContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
    });

    const handleForgotPassword = async () => {
        if (!identifier) {
            setError('Please enter your email or staff key');
            return;
        }

        try {
            setLoading(true);
            setError('');
            setSuccess(false);

            await (apiClient as any).makeRequest('/auth/forgot-password', 'POST', { identifier });
            
            console.log('✅ Forgot password request sent');
            console.log('Reset email sent');
            
            setSuccess(true);

            Alert.alert(
                'Password Reset Initiated',
                'Check your email for password reset instructions. If you don\'t receive an email, make sure to check your spam folder.',
                [
                    { 
                        text: 'OK'
                    }
                ]
            );
        } catch (err: any) {
            console.error('❌ Forgot password error:', err);
            setError(err.message || 'Failed to send password reset email. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (success && !loading) {
        return (
            <KeyboardAvoidingView 
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.container}
            >
                <View style={styles.content}>
                    <Text style={styles.title}>Password Reset</Text>
                    <Text style={styles.successMessage}>
                        ✅ Reset link has been sent to your email
                    </Text>
                    <Text style={styles.subtitle}>
                        Please check your email for instructions to reset your password. The link will expire in 1 hour.
                    </Text>
                    
                    <TouchableOpacity 
                        style={styles.button}
                        onPress={() => navigation.navigate('Login')}
                        disabled={loading}
                    >
                        <Text style={styles.buttonText}>Back to Login</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        );
    }

    return (
        <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.content}>
                <Text style={styles.title}>Reset Password</Text>
                <Text style={styles.subtitle}>
                    Enter your email to receive a password reset link
                </Text>

                <View style={styles.warningBox}>
                    <Text style={styles.warningTitle}>⚠️ Admin Only Feature</Text>
                    <Text style={styles.warningText}>
                        This feature is for restaurant administrators to reset their password via email.
                    </Text>
                    <Text style={[styles.warningText, { marginTop: 8 }]}>
                        <Text style={{ fontWeight: 'bold' }}>Staff members:</Text> Please ask your admin to regenerate your staff key.
                    </Text>
                </View>
                
                <TextInput
                    style={styles.input}
                    placeholder="Admin Email Address"
                    value={identifier}
                    onChangeText={setIdentifier}
                    autoCapitalize="none"
                    editable={!loading}
                    placeholderTextColor="#999"
                    keyboardType="email-address"
                />

                {error && <Text style={styles.error}>{error}</Text>}

                <TouchableOpacity 
                    style={[styles.button, loading && { opacity: 0.6 }]}
                    onPress={handleForgotPassword}
                    disabled={loading}
                >
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.buttonText}>Send Reset Link</Text>
                    )}
                </TouchableOpacity>

                <TouchableOpacity 
                    style={styles.backButton}
                    onPress={() => navigation.navigate('Login')}
                    disabled={loading}
                >
                    <Text style={styles.backButtonText}>Back to Login</Text>
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
};

export default ForgotPasswordScreen;
