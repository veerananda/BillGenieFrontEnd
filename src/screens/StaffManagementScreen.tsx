import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, RefreshControl, Clipboard } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/api';

type RootStackParamList = {
  StaffManagement: undefined;
  AddStaff: undefined;
  EditStaff: { userId: string; userName: string; userPhone: string; userRole: string };
};

type StaffManagementProps = NativeStackScreenProps<RootStackParamList, 'StaffManagement'>;

interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: 'manager' | 'staff' | 'chef';
  is_active: boolean;
  staff_key: string;
  created_at: string;
}

export const StaffManagementScreen: React.FC<StaffManagementProps> = ({ navigation }) => {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadStaff();
  }, []);

  const loadStaff = async () => {
    try {
      setLoading(true);
      const response = await (apiClient as any).makeRequest('/users', 'GET');
      if (response && response.staff) {
        setStaff(response.staff);
      } else if (Array.isArray(response)) {
        setStaff(response);
      }
    } catch (error: any) {
      console.error('Error loading staff:', error);
      Alert.alert('Error', 'Failed to load staff members');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStaff();
    setRefreshing(false);
  };

  const handleDeleteStaff = (staffId: string, staffName: string) => {
    Alert.alert(
      'Delete Staff Member',
      `Are you sure you want to delete ${staffName}?`,
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
              await (apiClient as any).makeRequest(`/users/${staffId}`, 'DELETE');
              Alert.alert('Success', 'Staff member deleted successfully');
              loadStaff();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete staff member');
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const renderStaffItem = ({ item }: { item: StaffMember }) => (
    <View style={styles.staffCard}>
      <View style={styles.staffInfo}>
        <Text style={styles.staffName}>{item.name}</Text>
        <Text style={styles.staffPhone}>{item.phone}</Text>
        
        {/* Staff Key Display */}
        <View style={styles.staffKeyContainer}>
          <Text style={styles.staffKeyLabel}>Staff Key:</Text>
          <View style={styles.staffKeyBox}>
            <Text style={styles.staffKeyText}>{item.staff_key}</Text>
            <TouchableOpacity
              style={styles.copyKeyButton}
              onPress={() => {
                Clipboard.setString(item.staff_key);
                Alert.alert('Copied', 'Staff key copied to clipboard');
              }}
            >
              <Text style={styles.copyKeyButtonText}>📋</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.staffMeta}>
          <Text style={[
            styles.roleTag, 
            item.role === 'manager' ? styles.managerTag : 
            item.role === 'chef' ? styles.chefTag : 
            styles.staffTag
          ]}>
            {item.role.toUpperCase()}
          </Text>
          <Text style={[styles.statusTag, item.is_active ? styles.activeTag : styles.inactiveTag]}>
            {item.is_active ? 'ACTIVE' : 'INACTIVE'}
          </Text>
        </View>
      </View>
      <View style={styles.staffActions}>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() =>
            navigation.navigate('EditStaff', {
              userId: item.id,
              userName: item.name,
              userPhone: item.phone,
              userRole: item.role,
            })
          }
        >
          <Text style={styles.actionButtonText}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => handleDeleteStaff(item.id, item.name)}
        >
          <Text style={styles.actionButtonText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {staff.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>👥</Text>
          <Text style={styles.emptyText}>No staff members yet</Text>
          <Text style={styles.emptySubtext}>Add your first staff member</Text>
        </View>
      ) : (
        <FlatList
          data={staff}
          renderItem={renderStaffItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      <TouchableOpacity
        style={styles.addButton}
        onPress={() => navigation.navigate('AddStaff')}
      >
        <Text style={styles.addButtonText}>+ Add Staff</Text>
      </TouchableOpacity>
    </View>
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
  listContent: {
    padding: 16,
    gap: 12,
  },
  staffCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  staffInfo: {
    flex: 1,
  },
  staffName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  staffEmail: {
    fontSize: 13,
    color: '#666',
    marginBottom: 2,
  },
  staffPhone: {
    fontSize: 13,
    color: '#999',
    marginBottom: 8,
  },
  staffKeyContainer: {
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 8,
  },
  staffKeyLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    marginBottom: 4,
  },
  staffKeyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  staffKeyText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333',
    flex: 1,
  },
  copyKeyButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  copyKeyButtonText: {
    fontSize: 14,
  },
  staffMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  roleTag: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  managerTag: {
    backgroundColor: '#ffd700',
    color: '#333',
  },
  staffTag: {
    backgroundColor: '#87ceeb',
    color: '#333',
  },
  chefTag: {
    backgroundColor: '#ff8c00',
    color: '#fff',
  },
  statusTag: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  activeTag: {
    backgroundColor: '#90ee90',
    color: '#333',
  },
  inactiveTag: {
    backgroundColor: '#ffb6c6',
    color: '#333',
  },
  staffActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 12,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#e3f2fd',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#ffebee',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 18,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
  },
  addButton: {
    backgroundColor: '#7c3aed',
    marginHorizontal: 16,
    marginBottom: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
