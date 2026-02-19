import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Text } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import apiClient from '../services/api';

type RootStackParamList = {
  Register: undefined;
  Login: undefined;
};

type RegisterScreenProps = NativeStackScreenProps<RootStackParamList, 'Register'>;

export const RegisterScreen: React.FC<RegisterScreenProps> = ({ navigation }) => {
  const [restaurantName, setRestaurantName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#ffffff',
    },
    scrollContent: {
      padding: 20,
      paddingBottom: 40,
    },
    header: {
      textAlign: 'center',
      marginBottom: 24,
      color: '#7c3aed',
      fontSize: 28,
      fontWeight: 'bold',
    },
    subtitle: {
      textAlign: 'center',
      marginBottom: 20,
      color: '#666',
      fontSize: 14,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: 'bold',
      color: '#7c3aed',
      marginTop: 16,
      marginBottom: 8,
    },
    label: {
      fontSize: 12,
      fontWeight: '600',
      color: '#333',
      marginBottom: 4,
      marginTop: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: '#ccc',
      padding: 12,
      marginBottom: 12,
      borderRadius: 4,
      fontSize: 16,
      backgroundColor: '#f9f9f9',
    },
    inputError: {
      borderColor: '#ff0000',
    },
    button: {
      backgroundColor: '#7c3aed',
      padding: 14,
      marginTop: 24,
      borderRadius: 4,
      alignItems: 'center',
      marginBottom: 12,
    },
    buttonText: {
      color: 'white',
      fontSize: 16,
      fontWeight: 'bold',
    },
    loginButton: {
      backgroundColor: '#e9ecef',
      padding: 14,
      borderRadius: 4,
      alignItems: 'center',
      marginBottom: 12,
    },
    loginButtonText: {
      color: '#333',
      fontSize: 16,
      fontWeight: '600',
    },
    error: {
      color: '#ff0000',
      textAlign: 'center',
      marginTop: 8,
      fontSize: 14,
      marginBottom: 12,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    successMessage: {
      backgroundColor: '#d4edda',
      padding: 12,
      borderRadius: 4,
      marginBottom: 12,
      borderLeftWidth: 4,
      borderLeftColor: '#28a745',
    },
    successText: {
      color: '#155724',
      fontSize: 14,
      fontWeight: '500',
    },
  });

  const validateForm = (): boolean => {
    if (!restaurantName.trim()) {
      setError('Restaurant name is required');
      return false;
    }
    if (!ownerName.trim()) {
      setError('Owner name is required');
      return false;
    }
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    // Validate email format using regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address');
      return false;
    }
    if (!phone.trim()) {
      setError('Phone number is required');
      return false;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleRegister = async () => {
    setError('');

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);

      // Call the register API
      const response = await apiClient.register({
        restaurant_name: restaurantName,
        owner_name: ownerName,
        email: email,
        phone: phone,
        password: password,
        address: address || undefined,
        city: city || undefined,
        cuisine: cuisine || undefined,
      });

      // Show success message and navigate to email verification
      const staffKey = response.staff_key || 'N/A';
      const restaurantCode = response.restaurant_code || response.code || 'N/A';
      
      Alert.alert(
        'Registration Successful! 🎉',
        `Welcome ${ownerName}!\n\nYour restaurant "${restaurantName}" has been created.\n\n🔑 Your Staff Key: ${staffKey}\n\n⚠️ IMPORTANT: Save this key! You will need it to login.`,
        [
          {
            text: 'Verify Email',
            onPress: () => {
              navigation.replace('EmailVerification', {
                restaurantId: response.id,
                email: email,
                restaurantCode: restaurantCode,
              });
            },
          },
        ]
      );
    } catch (err: any) {
      const errorMessage = err.message || 'Registration failed. Please try again.';
      setError(errorMessage);
      Alert.alert('Registration Failed', errorMessage);
      console.error('Registration error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={{ marginTop: 10 }}>Creating your restaurant...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.header}>🍽️ Register</Text>
        <Text style={styles.subtitle}>Create your restaurant account</Text>

        {error ? <Text style={styles.error}>⚠️ {error}</Text> : null}

        {/* Restaurant Information */}
        <Text style={styles.sectionTitle}>Restaurant Information</Text>
        
        <Text style={styles.label}>Restaurant Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Taj Mahal Restaurant"
          value={restaurantName}
          onChangeText={setRestaurantName}
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        <Text style={styles.label}>Cuisine Type (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Indian, Chinese, Italian"
          value={cuisine}
          onChangeText={setCuisine}
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        <Text style={styles.label}>Address (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., 123 Main Street"
          value={address}
          onChangeText={setAddress}
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        <Text style={styles.label}>City (Optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Mumbai"
          value={city}
          onChangeText={setCity}
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        {/* Owner Information */}
        <Text style={styles.sectionTitle}>Owner Information</Text>
        
        <Text style={styles.label}>Owner/Manager Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Rajesh Kumar"
          value={ownerName}
          onChangeText={setOwnerName}
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        <Text style={styles.label}>Email *</Text>
        <TextInput
          style={[styles.input, error && error.includes('email') ? styles.inputError : {}]}
          placeholder="e.g., owner@restaurant.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        <Text style={styles.label}>Phone Number *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., +91-9876543210"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        {/* Security Information */}
        <Text style={styles.sectionTitle}>Security</Text>
        
        <Text style={styles.label}>Password * (Minimum 6 characters)</Text>
        <TextInput
          style={[styles.input, error && error.includes('Password') ? styles.inputError : {}]}
          placeholder="Enter a strong password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        <Text style={styles.label}>Confirm Password *</Text>
        <TextInput
          style={[styles.input, error && error.includes('match') ? styles.inputError : {}]}
          placeholder="Confirm your password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          editable={!loading}
          placeholderTextColor="#aaa"
        />

        {/* Buttons */}
        <TouchableOpacity
          style={styles.button}
          onPress={handleRegister}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Creating Account...' : 'Create Restaurant Account'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.loginButton}
          onPress={() => navigation.replace('Login')}
          disabled={loading}
        >
          <Text style={styles.loginButtonText}>
            Already have an account? Login
          </Text>
        </TouchableOpacity>

        <Text style={{ textAlign: 'center', color: '#999', fontSize: 12, marginTop: 16 }}>
          By registering, you agree to our Terms of Service and Privacy Policy
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};
