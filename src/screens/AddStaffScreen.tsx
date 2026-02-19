import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import apiClient from '../services/api';

type RootStackParamList = {
  StaffManagement: undefined;
  AddStaff: undefined;
};

type AddStaffProps = NativeStackScreenProps<RootStackParamList, 'AddStaff'>;

export const AddStaffScreen: React.FC<AddStaffProps> = ({ navigation }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'manager' | 'staff' | 'chef'>('staff');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validateForm = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!name.trim()) {
      newErrors.name = 'Name is required';
    } else if (name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    }

    if (!phone.trim()) {
      newErrors.phone = 'Phone is required';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateStaff = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);

      // Check current account count
      const usersResponse = await (apiClient as any).makeRequest('/users', 'GET');
      let users = usersResponse?.users || usersResponse || [];
      
      // Ensure users is an array
      if (!Array.isArray(users)) {
        console.warn('Users response is not an array:', users);
        users = [];
      }
      
      console.log('📊 Current users:', users);
      console.log('🎯 Creating role:', role);
      
      // Count accounts by role (1 admin, 1 manager, 2 staff, 1 chef = 5 total)
      const roleCounts = {
        admin: users.filter((u: any) => u.role === 'admin').length,
        manager: users.filter((u: any) => u.role === 'manager').length,
        staff: users.filter((u: any) => u.role === 'staff').length,
        chef: users.filter((u: any) => u.role === 'chef').length,
      };
      
      console.log('📈 Role counts:', roleCounts);

      // Validate account limits
      if (role === 'manager' && roleCounts.manager >= 1) {
        Alert.alert('Limit Reached', 'Only 1 manager account is allowed per restaurant.');
        setLoading(false);
        return;
      }
      
      if (role === 'staff' && roleCounts.staff >= 2) {
        Alert.alert('Limit Reached', 'Only 2 staff accounts are allowed per restaurant.');
        setLoading(false);
        return;
      }
      
      if (role === 'chef' && roleCounts.chef >= 1) {
        Alert.alert('Limit Reached', 'Only 1 chef account is allowed per restaurant.');
        setLoading(false);
        return;
      }
      
      console.log('✅ Validation passed, creating user...');

      const response = await (apiClient as any).makeRequest('/users', 'POST', {
        name: name.trim(),
        phone: phone.trim(),
        password,
        role,
      });

      const roleTitle = role === 'manager' ? 'Manager' : role === 'chef' ? 'Chef' : 'Staff';
      Alert.alert('Success', `${roleTitle} created successfully!`, [
        {
          text: 'OK',
          onPress: () => {
            navigation.navigate('StaffManagement');
          },
        },
      ]);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to create staff member';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Add New Staff</Text>
        <Text style={styles.headerSubtitle}>Create a new manager or staff account</Text>
      </View>

      <View style={styles.form}>
        {/* Name Field */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Full Name *</Text>
          <TextInput
            style={[styles.input, errors.name ? styles.inputError : {}]}
            placeholder="Enter staff member's full name"
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (errors.name) {
                setErrors({ ...errors, name: '' });
              }
            }}
            editable={!loading}
          />
          {errors.name ? <Text style={styles.errorText}>{errors.name}</Text> : null}
        </View>

        {/* Phone Field */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Phone Number *</Text>
          <TextInput
            style={[styles.input, errors.phone ? styles.inputError : {}]}
            placeholder="Enter phone number"
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              if (errors.phone) {
                setErrors({ ...errors, phone: '' });
              }
            }}
            keyboardType="phone-pad"
            editable={!loading}
          />
          {errors.phone ? <Text style={styles.errorText}>{errors.phone}</Text> : null}
        </View>

        {/* Role Selection */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Role *</Text>
          <View style={styles.roleContainer}>
            <TouchableOpacity
              style={[styles.roleButton, role === 'manager' && styles.roleButtonActive]}
              onPress={() => setRole('manager')}
              disabled={loading}
            >
              <Text style={[styles.roleButtonText, role === 'manager' && styles.roleButtonTextActive]}>
                👔 Manager
              </Text>
              <Text style={[styles.roleButtonDesc, role === 'manager' && styles.roleButtonDescActive]}>
                Can manage menu & inventory
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleButton, role === 'staff' && styles.roleButtonActive]}
              onPress={() => setRole('staff')}
              disabled={loading}
            >
              <Text style={[styles.roleButtonText, role === 'staff' && styles.roleButtonTextActive]}>
                👨‍💼 Staff
              </Text>
              <Text style={[styles.roleButtonDesc, role === 'staff' && styles.roleButtonDescActive]}>
                Can view orders & billing only
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleButton, role === 'chef' && styles.roleButtonActive]}
              onPress={() => setRole('chef')}
              disabled={loading}
            >
              <Text style={[styles.roleButtonText, role === 'chef' && styles.roleButtonTextActive]}>
                👨‍🍳 Chef
              </Text>
              <Text style={[styles.roleButtonDesc, role === 'chef' && styles.roleButtonDescActive]}>
                Can view kitchen updates only
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Password Field */}
        <View style={styles.formGroup}>
          <Text style={styles.label}>Password *</Text>
          <TextInput
            style={[styles.input, errors.password ? styles.inputError : {}]}
            placeholder="Enter password (min 6 characters)"
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (errors.password) {
                setErrors({ ...errors, password: '' });
              }
            }}
            secureTextEntry
            editable={!loading}
          />
          {errors.password ? <Text style={styles.errorText}>{errors.password}</Text> : null}
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>💡 Tips</Text>
          <Text style={styles.infoText}>
            • Use a strong password{'\n'}
            • Email should be unique{'\n'}
            • Account limits: 1 Manager, 2 Staff, 1 Chef{'\n'}
            • Staff can only view Orders & Billing{'\n'}
            • Chef can only view Kitchen Updates
          </Text>
        </View>

        {/* Create Button */}
        <TouchableOpacity
          style={[styles.createButton, loading && styles.createButtonDisabled]}
          onPress={handleCreateStaff}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.createButtonText}>Create Staff Member</Text>
          )}
        </TouchableOpacity>

        {/* Cancel Button */}
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
          disabled={loading}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 20,
    paddingVertical: 20,
    paddingTop: 30,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  form: {
    padding: 20,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#333',
  },
  inputError: {
    borderColor: '#ff6b6b',
    backgroundColor: '#ffebee',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 12,
    marginTop: 6,
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  roleButton: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  roleButtonActive: {
    backgroundColor: '#f3e5f5',
    borderColor: '#7c3aed',
  },
  roleButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#666',
    marginBottom: 4,
  },
  roleButtonTextActive: {
    color: '#7c3aed',
  },
  roleButtonDesc: {
    fontSize: 11,
    color: '#999',
  },
  roleButtonDescActive: {
    color: '#7c3aed',
  },
  infoBox: {
    backgroundColor: '#e3f2fd',
    borderLeftWidth: 4,
    borderLeftColor: '#2196f3',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  infoTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1976d2',
    marginBottom: 6,
  },
  infoText: {
    fontSize: 12,
    color: '#1565c0',
    lineHeight: 18,
  },
  createButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
