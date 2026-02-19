import React, { useState } from 'react';
import { StyleSheet, View, KeyboardAvoidingView, Platform, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';
import { wsService } from '../services/websocket';
import { syncOfflineOrdersToDatabase } from '../utils/StorageSync';

type RootStackParamList = {
  Login: undefined;
  Home: undefined;
  AddMenuPricing: undefined;
};

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;

export const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

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
            marginBottom: 48,
            color: '#7c3aed',
            fontSize: 28,
            fontWeight: 'bold',
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
        error: {
            color: '#ff0000',
            textAlign: 'center',
            marginTop: 8,
            fontSize: 14,
        },
        loadingContainer: {
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
        },
    });

    const handleLogin = async () => {
        if (!identifier || !password) {
            setError('Please fill in all fields');
            return;
        }

        try {
            setLoading(true);
            setError('');
            
            // Call the login API with identifier (email or staff key) and password
            const response = await apiClient.login({ identifier, password });
            console.log('✅ Login successful, token stored by apiClient');
            
            // Store user role
            await AsyncStorage.setItem('user_role', response.role || 'staff');
            console.log('✅ User role stored:', response.role);
            
            // Connect to WebSocket
            console.log('🔌 Connecting to WebSocket...');
            await wsService.connect();
            
                        // Sync offline orders from AsyncStorage to database
                        try {
                            const syncResult = await syncOfflineOrdersToDatabase();
                            if (syncResult.synced > 0) {
                                console.log(`✅ [Login] Synced ${syncResult.synced} offline orders`);
                            }
                            if (syncResult.failed > 0) {
                                console.log(`⚠️  [Login] ${syncResult.failed} orders failed to sync`);
                            }
                        } catch (e) {
                            console.warn('⚠️ [Login] Offline order sync failed', e);
                        }
            
            // Navigate to home screen
            navigation.replace('Home');
        } catch (err: any) {
            const errorMessage = err.message || 'Invalid email or password';
            setError(errorMessage);
            Alert.alert('Login Failed', errorMessage);
            console.error('Login error:', err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#7c3aed" />
                <Text style={{ marginTop: 10 }}>Logging in...</Text>
            </View>
        );
    }

    return (
        <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.container}
        >
            <View style={styles.content}>
                <Text style={styles.title}>
                    BillGenie
                </Text>
                
                <TextInput
                    style={styles.input}
                    placeholder="Email or Staff Key"
                    value={identifier}
                    onChangeText={setIdentifier}
                    keyboardType="default"
                    autoCapitalize="none"
                />

                <TextInput
                    style={styles.input}
                    placeholder="Password"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                />

                {error ? (
                    <Text style={styles.error}>{error}</Text>
                ) : null}

                <TouchableOpacity 
                    style={styles.button}
                    onPress={handleLogin}
                >
                    <Text style={styles.buttonText}>Login</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    onPress={() => navigation.navigate('ForgotPassword' as any)}
                    style={{ marginTop: 16 }}
                >
                    <Text style={{ color: '#7c3aed', fontSize: 14, textAlign: 'center', fontWeight: '600' }}>
                        Forgot Password?
                    </Text>
                </TouchableOpacity>

                <View style={{ marginTop: 24, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ color: '#666', fontSize: 14, marginRight: 8 }}>Don't have an account?</Text>
                    <TouchableOpacity onPress={() => navigation.navigate('Register' as any)}>
                        <Text style={{ color: '#7c3aed', fontSize: 14, fontWeight: 'bold' }}>Sign Up</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardAvoidingView>
    );
};