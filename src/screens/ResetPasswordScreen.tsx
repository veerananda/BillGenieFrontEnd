import React, { useState } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import apiClient from '../services/api';

type RootStackParamList = {
  ResetPassword: { token: string };
  Login: undefined;
};

type ResetPasswordScreenProps = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

export const ResetPasswordScreen: React.FC<ResetPasswordScreenProps> = ({ navigation, route }) => {
    const { token } = route.params;
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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
        inputContainer: {
            position: 'relative',
            marginBottom: 16,
        },
        input: {
            borderWidth: 1,
            borderColor: '#ccc',
            padding: 12,
            borderRadius: 4,
            fontSize: 16,
            paddingRight: 40,
        },
        toggleButton: {
            position: 'absolute',
            right: 12,
            top: 12,
        },
        toggleButtonText: {
            color: '#7c3aed',
            fontSize: 14,
            fontWeight: 'bold',
        },
        passwordRequirements: {
            backgroundColor: '#f5f5f5',
            padding: 12,
            borderRadius: 4,
            marginBottom: 16,
        },
        requirementText: {
            color: '#666',
            fontSize: 12,
            marginBottom: 4,
        },
        requirementMet: {
            color: '#00aa00',
        },
        requirementNotMet: {
            color: '#ff0000',
        },
        button: {
            backgroundColor: '#7c3aed',
            padding: 12,
            marginTop: 24,
            borderRadius: 4,
            alignItems: 'center',
        },
        buttonDisabled: {
            backgroundColor: '#ccc',
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
            marginBottom: 16,
            fontSize: 14,
        },
        successMessage: {
            color: '#00aa00',
            textAlign: 'center',
            marginBottom: 16,
            fontSize: 14,
        },
        loadingContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
    });

    const passwordsMatch = newPassword === confirmPassword && newPassword.length >= 6;
    const hasMinLength = newPassword.length >= 6;

    const handleResetPassword = async () => {
        if (!newPassword || !confirmPassword) {
            setError('Please fill in all fields');
            return;
        }

        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        try {
            setLoading(true);
            setError('');

            await (apiClient as any).makeRequest('/auth/reset-password', 'POST', { 
                token, 
                new_password: newPassword 
            });
            
            console.log('✅ Password reset successful');
            
            Alert.alert(
                'Success',
                'Your password has been reset successfully. Please login with your new password.',
                [
                    { 
                        text: 'OK', 
                        onPress: () => {
                            navigation.navigate('Login');
                        }
                    }
                ]
            );
        } catch (err: any) {
            console.error('❌ Password reset error:', err);
            setError(err.message || 'Failed to reset password. The reset link may have expired. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.content}>
                <Text style={styles.title}>Create New Password</Text>
                <Text style={styles.subtitle}>
                    Enter your new password below
                </Text>
                
                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        placeholder="New Password"
                        value={newPassword}
                        onChangeText={setNewPassword}
                        autoCapitalize="none"
                        secureTextEntry={!showPassword}
                        editable={!loading}
                        placeholderTextColor="#999"
                    />
                    <TouchableOpacity 
                        style={styles.toggleButton}
                        onPress={() => setShowPassword(!showPassword)}
                    >
                        <Text style={styles.toggleButtonText}>
                            {showPassword ? 'Hide' : 'Show'}
                        </Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.inputContainer}>
                    <TextInput
                        style={styles.input}
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        autoCapitalize="none"
                        secureTextEntry={!showConfirmPassword}
                        editable={!loading}
                        placeholderTextColor="#999"
                    />
                    <TouchableOpacity 
                        style={styles.toggleButton}
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                        <Text style={styles.toggleButtonText}>
                            {showConfirmPassword ? 'Hide' : 'Show'}
                        </Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.passwordRequirements}>
                    <Text style={[
                        styles.requirementText,
                        hasMinLength ? styles.requirementMet : styles.requirementNotMet
                    ]}>
                        {hasMinLength ? '✓' : '✗'} At least 6 characters
                    </Text>
                    <Text style={[
                        styles.requirementText,
                        passwordsMatch ? styles.requirementMet : styles.requirementNotMet
                    ]}>
                        {passwordsMatch ? '✓' : '✗'} Passwords match
                    </Text>
                </View>

                {error && <Text style={styles.error}>{error}</Text>}

                <TouchableOpacity 
                    style={[styles.button, !passwordsMatch && styles.buttonDisabled]}
                    onPress={handleResetPassword}
                    disabled={loading || !passwordsMatch}
                >
                    {loading ? (
                        <ActivityIndicator color="white" />
                    ) : (
                        <Text style={styles.buttonText}>Reset Password</Text>
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

export default ResetPasswordScreen;
