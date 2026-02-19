import React, { useState } from 'react';
import { StyleSheet, View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import apiClient from '../services/api';

type RootStackParamList = {
  StaffManagement: undefined;
  EditStaff: { userId: string; userName: string; userEmail: string; userPhone: string; userRole: string };
};

type EditStaffProps = NativeStackScreenProps<RootStackParamList, 'EditStaff'>;

export const EditStaffScreen: React.FC<EditStaffProps> = ({ navigation, route }) => {
  const { userId, userName, userEmail, userPhone, userRole } = route.params;

  const [name, setName] = useState(userName);
  const [phone, setPhone] = useState(userPhone);
  const [role, setRole] = useState<'manager' | 'staff' | 'chef'>(userRole as 'manager' | 'staff' | 'chef');
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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSaveChanges = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);

      await (apiClient as any).makeRequest(`/users/${userId}`, 'PUT', {
        name: name.trim(),
        phone: phone.trim(),
        role,
      });

      Alert.alert('Success', 'Staff member updated successfully!', [
        {
          text: 'OK',
          onPress: () => {
            navigation.reset({
              index: 1,
              routes: [
                { name: 'Home' },
                { name: 'StaffManagement' },
              ],
            });
          },
        },
      ]);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to update staff member';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteStaff = () => {
    Alert.alert(
      'Delete Staff Member',
      `Are you sure you want to delete ${name}? This action cannot be undone.`,
      [
        {
          text: 'Cancel',
          onPress: () => {},
          style: 'cancel',
        },
        {
          text: 'Delete',
          onPress: async () => {
            try {
              setLoading(true);
              await (apiClient as any).makeRequest(`/users/${userId}`, 'DELETE');
              Alert.alert('Success', 'Staff member deleted successfully!', [
                {
                  text: 'OK',
                  onPress: () => {
                    navigation.reset({
                      index: 1,
                      routes: [
                        { name: 'Home' },
                        { name: 'StaffManagement' },
                      ],
                    });
                  },
                },
              ]);
            } catch (error: any) {
              Alert.alert('Error', 'Failed to delete staff member');
            } finally {
              setLoading(false);
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const handleRegenerateStaffKey = () => {
    Alert.alert(
      'Regenerate Staff Key',
      `Generate a new staff key for ${name}? The old key will no longer work.`,
      [
        {
          text: 'Cancel',
          onPress: () => {},
          style: 'cancel',
        },
        {
          text: 'Regenerate',
          onPress: async () => {
            try {
              setLoading(true);
              const response = await (apiClient as any).makeRequest(`/users/${userId}/regenerate-key`, 'POST');
              
              Alert.alert(
                'Staff Key Regenerated',
                `New Staff Key: ${response.staff_key}\n\nShare this key with the staff member. The old key is no longer valid.`,
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      setLoading(false);
                    },
                  },
                ]
              );
            } catch (error: any) {
              const errorMessage = error.response?.data?.error || 'Failed to regenerate staff key';
              Alert.alert('Error', errorMessage);
              setLoading(false);
            }
          },
          style: 'default',
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
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

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>ℹ️ Information</Text>
          <Text style={styles.infoText}>
            • Changes will take effect the next time the staff member logs in{'\n'}
            • Changing role will update their permissions immediately{'\n'}
            • Email cannot be changed after creation
          </Text>
        </View>

        {/* Save Button */}
        <TouchableOpacity
          style={[styles.saveButton, loading && styles.saveButtonDisabled]}
          onPress={handleSaveChanges}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>

        {/* Regenerate Staff Key Button - Only for staff/manager, not for admin */}
        {userRole !== 'admin' && (
          <TouchableOpacity
            style={[styles.regenerateButton, loading && styles.regenerateButtonDisabled]}
            onPress={handleRegenerateStaffKey}
            disabled={loading}
          >
            <Text style={styles.regenerateButtonText}>🔑 Regenerate Staff Key</Text>
          </TouchableOpacity>
        )}

        {/* Delete Button */}
        <TouchableOpacity
          style={[styles.deleteButton, loading && styles.deleteButtonDisabled]}
          onPress={handleDeleteStaff}
          disabled={loading}
        >
          <Text style={styles.deleteButtonText}>Delete Staff Member</Text>
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
  readOnlyInput: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  readOnlyText: {
    fontSize: 14,
    color: '#666',
  },
  helperText: {
    fontSize: 12,
    color: '#999',
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
  saveButton: {
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  regenerateButton: {
    backgroundColor: '#fff3e0',
    borderWidth: 1,
    borderColor: '#ff9800',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  regenerateButtonDisabled: {
    opacity: 0.6,
  },
  regenerateButtonText: {
    color: '#ff9800',
    fontSize: 16,
    fontWeight: 'bold',
  },
  deleteButton: {
    backgroundColor: '#ffebee',
    borderWidth: 1,
    borderColor: '#ff6b6b',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  deleteButtonDisabled: {
    opacity: 0.6,
  },
  deleteButtonText: {
    color: '#ff6b6b',
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
