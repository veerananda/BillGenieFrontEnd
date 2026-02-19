import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  Switch,
  Modal,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, RestaurantTable } from '../services/api';

type RootStackParamList = {
  Home: undefined;
  RestaurantProfile: undefined;
  Orders: undefined;
};

type RestaurantProfileScreenProps = NativeStackScreenProps<RootStackParamList, 'RestaurantProfile'>;

interface RestaurantProfile {
  name: string;
  address: string;
  contactNumber: string;
  upiQrCode?: string; // Base64 or URI
  isSelfService: boolean;
  subscriptionEnd?: string; // ISO 8601 date string
}

export const RestaurantProfileScreen: React.FC<RestaurantProfileScreenProps> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<RestaurantProfile>({
    name: '',
    address: '',
    contactNumber: '',
    upiQrCode: undefined,
    isSelfService: true,
  });
  const [tableNames, setTableNames] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [selectedTable, setSelectedTable] = useState<RestaurantTable | null>(null);
  const [showTableModal, setShowTableModal] = useState(false);
  const [editTableName, setEditTableName] = useState('');
  const [editTableCapacity, setEditTableCapacity] = useState('');
  const [isNewTable, setIsNewTable] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const data = await apiClient.getRestaurantProfile();
      setProfile({
        name: data.name || '',
        address: data.address || '',
        contactNumber: data.contact_number || data.phone || '',
        upiQrCode: data.upi_qr_code || undefined,
        isSelfService: data.is_self_service || false,
        subscriptionEnd: data.subscription_end || undefined,
      });
      
      // Load tables if in dine-in mode
      if (!data.is_self_service) {
        await loadTables();
      }
    } catch (error) {
      console.error('Error loading profile:', error);
      Alert.alert('Error', 'Failed to load restaurant profile');
    } finally {
      setLoading(false);
    }
  };

  const loadTables = async () => {
    try {
      const tablesList = await apiClient.getTables();
      setTables(tablesList);
    } catch (error) {
      console.error('Error loading tables:', error);
    }
  };

  const handleSave = async () => {
    if (!profile.name.trim()) {
      Alert.alert('Error', 'Please enter restaurant name');
      return;
    }

    setSaving(true);
    try {
      console.log('💾 SAVING PROFILE:');
      console.log('  - Profile state isSelfService:', profile.isSelfService);
      console.log('  - Sending to API is_self_service:', profile.isSelfService);
      
      // Save restaurant profile first
      const updatePayload = {
        name: profile.name,
        address: profile.address,
        contact_number: profile.contactNumber,
        upi_qr_code: profile.upiQrCode,
        is_self_service: profile.isSelfService,
      };
      
      console.log('📤 API Payload:', JSON.stringify(updatePayload, null, 2));
      await apiClient.updateRestaurantProfile(updatePayload);
      
      console.log('✅ Profile saved successfully');
      
      // VERIFY what was saved
      const verifyProfile = await apiClient.getRestaurantProfile();
      console.log('✔️ VERIFICATION - Profile from backend:', JSON.stringify(verifyProfile, null, 2));
      console.log('✔️ Backend is_self_service:', verifyProfile.is_self_service);

      // If switching to dine-in mode, load tables
      if (!profile.isSelfService) {
        try {
          console.log('🪑 Dine-in mode enabled - loading tables');
          await loadTables();
        } catch (tableError) {
          console.error('❌ Table loading failed:', tableError);
        }
      }

      Alert.alert('Success', 'Restaurant profile and settings saved successfully');
    } catch (error) {
      console.error('Error saving profile:', error);
      Alert.alert('Error', 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handlePickQRCode = async () => {
    Alert.alert(
      'Add QR Code',
      'To add a UPI QR code:\n\n1. Save your UPI QR code image to your device\n2. For now, you can enter a placeholder URL\n\nIn production, use expo-image-picker or react-native-image-picker to select from gallery.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Add Sample QR',
          onPress: () => {
            // For demo purposes, use a placeholder
            setProfile({ 
              ...profile, 
              upiQrCode: 'https://via.placeholder.com/300x300.png?text=UPI+QR+Code' 
            });
          },
        },
      ]
    );
  };

  const handleRemoveQRCode = () => {
    Alert.alert(
      'Remove QR Code',
      'Are you sure you want to remove the UPI QR code?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => setProfile({ ...profile, upiQrCode: undefined }),
        },
      ]
    );
  };

  const handleDeleteTable = (tableId: string, tableName: string) => {
    Alert.alert(
      'Delete Table',
      `Are you sure you want to delete table "${tableName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.deleteTable(tableId);
              await loadTables();
              setShowTableModal(false);
              Alert.alert('Success', `Table "${tableName}" deleted`);
            } catch (error) {
              Alert.alert('Error', `Failed to delete table: ${(error as any).message}`);
            }
          }
        }
      ]
    );
  };

  const handleTableClick = (table: RestaurantTable) => {
    setSelectedTable(table);
    setEditTableName(table.name);
    setEditTableCapacity(String(table.capacity || ''));
    setIsNewTable(false);
    setShowTableModal(true);
  };

  const handleAddNewTable = () => {
    setSelectedTable(null);
    setEditTableName('');
    setEditTableCapacity('');
    setIsNewTable(true);
    setShowTableModal(true);
  };

  const handleUpdateTableName = async () => {
    if (!editTableName.trim()) {
      Alert.alert('Error', 'Please enter a valid table name');
      return;
    }

    const capacity = editTableCapacity ? parseInt(editTableCapacity) : undefined;
    if (editTableCapacity && isNaN(capacity!)) {
      Alert.alert('Error', 'Capacity must be a valid number');
      return;
    }

    try {
      if (isNewTable) {
        // Create new table
        const newTableName = editTableName.trim();
        console.log('📊 Creating new table:', newTableName, 'with capacity:', capacity);
        const result = await apiClient.createBulkTables(newTableName);
        
        if (result && result.tables && result.tables.length > 0) {
          const createdTable = result.tables[0];
          
          // Update capacity if provided
          if (capacity) {
            await apiClient.updateTable(createdTable.id, { capacity });
          }
          
          await loadTables();
          setShowTableModal(false);
          Alert.alert('Success', `Table "${newTableName}" created`);
        }
      } else if (selectedTable) {
        // Update existing table
        if (editTableName === selectedTable.name && capacity === selectedTable.capacity) {
          setShowTableModal(false);
          return;
        }

        await apiClient.updateTable(selectedTable.id, { 
          name: editTableName,
          capacity: capacity,
        });
        await loadTables();
        setShowTableModal(false);
        Alert.alert('Success', 'Table updated');
      }
    } catch (error) {
      Alert.alert('Error', `Failed to save table: ${(error as any).message}`);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#7c3aed" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: (styles.content?.paddingBottom || 0) + insets.bottom + 120 }]}>
        <Text style={styles.title}>Restaurant Profile</Text>

        {/* Subscription Status Card */}
        {profile.subscriptionEnd && (
          <View style={styles.subscriptionCard}>
            <View style={styles.subscriptionHeader}>
              <Text style={styles.subscriptionIcon}>💳</Text>
              <Text style={styles.subscriptionTitle}>Subscription Status</Text>
            </View>
            <View style={styles.subscriptionDetails}>
              <Text style={styles.subscriptionLabel}>Plan:</Text>
              <Text style={styles.subscriptionValue}>BillGenie Standard (₹499/month)</Text>
            </View>
            <View style={styles.subscriptionDetails}>
              <Text style={styles.subscriptionLabel}>Renewal Date:</Text>
              <Text style={styles.subscriptionValue}>
                {new Date(profile.subscriptionEnd).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </Text>
            </View>
            <View style={styles.subscriptionDetails}>
              <Text style={styles.subscriptionLabel}>Days Remaining:</Text>
              <Text style={[
                styles.subscriptionValue,
                {
                  color: Math.ceil((new Date(profile.subscriptionEnd).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) <= 7
                    ? '#dc2626'
                    : '#16a34a'
                }
              ]}>
                {Math.ceil((new Date(profile.subscriptionEnd).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days
              </Text>
            </View>
            <View style={styles.subscriptionLimits}>
              <Text style={styles.limitsTitle}>Account Limits:</Text>
              <Text style={styles.limitsText}>• 1 Admin Account</Text>
              <Text style={styles.limitsText}>• 1 Manager Account</Text>
              <Text style={styles.limitsText}>• 3 Staff Accounts (including chefs)</Text>
            </View>
          </View>
        )}

        {/* Restaurant Name */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Restaurant Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter restaurant name"
            value={profile.name}
            onChangeText={(text) => setProfile({ ...profile, name: text })}
          />
        </View>

        {/* Address */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Address</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Enter restaurant address"
            value={profile.address}
            onChangeText={(text) => setProfile({ ...profile, address: text })}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Phone Number */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter phone number"
            value={profile.contactNumber}
            onChangeText={(text) => setProfile({ ...profile, contactNumber: text })}
            keyboardType="phone-pad"
          />
        </View>

        {/* Business Model Toggle */}
        <View style={styles.inputGroup}>
          <View style={styles.toggleHeader}>
            <View>
              <Text style={styles.label}>Business Model</Text>
              <Text style={styles.helperText}>
                {profile.isSelfService ? '🍔 Self-Service Only' : '🪑 Dine-In with Tables'}
              </Text>
            </View>
            <Switch
              value={profile.isSelfService}
              onValueChange={(value) => setProfile({ ...profile, isSelfService: value })}
              trackColor={{ false: '#7c3aed', true: '#7c3aed' }}
              thumbColor={profile.isSelfService ? '#4ade80' : '#fff'}
            />
          </View>
          <Text style={styles.toggleDescription}>
            {profile.isSelfService 
              ? '🍔 Customers order directly without table assignment'
              : '🪑 Customers order from tables (table management available)'}
          </Text>
        </View>

        {/* Table Management - Only visible when Dine-In mode is enabled */}
        {!profile.isSelfService && (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Tables</Text>
              <Text style={styles.helperText}>
                Add and manage your restaurant tables
              </Text>
              
              {/* Add Table Button */}
              <TouchableOpacity
                style={styles.addTableBtn}
                onPress={handleAddNewTable}
              >
                <Text style={styles.addTableBtnIcon}>+</Text>
                <Text style={styles.addTableBtnText}>Add New Table</Text>
              </TouchableOpacity>
            </View>

            {/* Existing Tables List */}
            {tables.length > 0 && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Existing Tables ({tables.length})</Text>
                <Text style={styles.helperText}>
                  Click on a table to edit or delete
                </Text>
                <View style={styles.tablesGrid}>
                  {tables.map((table) => (
                    <TouchableOpacity
                      key={table.id}
                      style={styles.tableButton}
                      onPress={() => handleTableClick(table)}
                    >
                      <Text style={styles.tableButtonText}>{table.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
          </>
        )}

        {/* UPI QR Code */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>UPI Payment QR Code</Text>
          <Text style={styles.helperText}>
            Upload a QR code for customers to scan and pay via UPI
          </Text>

          {profile.upiQrCode ? (
            <View style={styles.qrPreviewContainer}>
              <Image
                source={{ uri: profile.upiQrCode }}
                style={styles.qrPreview}
                resizeMode="contain"
              />
              <View style={styles.qrActions}>
                <TouchableOpacity
                  style={[styles.qrBtn, styles.changeBtn]}
                  onPress={handlePickQRCode}
                >
                  <Text style={styles.qrBtnText}>Change QR</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.qrBtn, styles.removeBtn]}
                  onPress={handleRemoveQRCode}
                >
                  <Text style={styles.qrBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.uploadBtn}
              onPress={handlePickQRCode}
            >
              <Text style={styles.uploadIcon}>📷</Text>
              <Text style={styles.uploadText}>Upload QR Code</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Table Details Modal */}
      <Modal
        visible={showTableModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTableModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isNewTable ? 'Create New Table' : 'Edit Table'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowTableModal(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.modalCloseBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <View style={styles.modalSection}>
                <Text style={styles.modalLabel}>Table Number</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editTableName}
                  onChangeText={setEditTableName}
                  placeholder="Enter table name"
                />
              </View>

              <View style={styles.modalSection}>
                <Text style={styles.modalLabel}>Seating Capacity (Number of Members)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={editTableCapacity}
                  onChangeText={setEditTableCapacity}
                  placeholder="Enter number of seats"
                  keyboardType="number-pad"
                />
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleUpdateTableName}
                >
                  <Text style={styles.modalSaveBtnText}>
                    {isNewTable ? 'Create Table' : 'Save Changes'}
                  </Text>
                </TouchableOpacity>
                {!isNewTable && selectedTable && (
                  <TouchableOpacity
                    style={styles.modalDeleteBtn}
                    onPress={() => {
                      handleDeleteTable(selectedTable.id, selectedTable.name);
                    }}
                  >
                    <Text style={styles.modalDeleteBtnText}>Delete Table</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Save Button */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }] }>
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Profile</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 24,
  },
  subscriptionCard: {
    backgroundColor: '#F0F9FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  subscriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  subscriptionIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  subscriptionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1E40AF',
  },
  subscriptionDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  subscriptionLabel: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  subscriptionValue: {
    fontSize: 14,
    color: '#1E293B',
    fontWeight: '600',
  },
  subscriptionLimits: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#BFDBFE',
  },
  limitsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E40AF',
    marginBottom: 6,
  },
  limitsText: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 4,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  helperText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
  },
  toggleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  toggleDescription: {
    fontSize: 13,
    color: '#666',
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  uploadBtn: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#7c3aed',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  uploadText: {
    fontSize: 16,
    color: '#7c3aed',
    fontWeight: '600',
  },
  qrPreviewContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  qrPreview: {
    width: 250,
    height: 250,
    marginBottom: 16,
  },
  qrActions: {
    flexDirection: 'row',
    gap: 12,
  },
  qrBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  changeBtn: {
    backgroundColor: '#7c3aed',
  },
  removeBtn: {
    backgroundColor: '#ef4444',
  },
  qrBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  footer: {
  position: 'absolute',
  bottom: 0,
  zIndex: 50,
  elevation: 20,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  saveBtn: {
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  // Tables Grid Styles
  addTableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    backgroundColor: '#e8f5e9',
    borderWidth: 2,
    borderColor: '#4caf50',
    borderRadius: 8,
    marginBottom: 16,
  },
  addTableBtnIcon: {
    fontSize: 24,
    fontWeight: '700',
    color: '#2e7d32',
    marginRight: 8,
  },
  addTableBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2e7d32',
  },
  tablesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  tableButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#7c3aed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    width: '24%',
    marginRight: '1%',
    marginBottom: 4,
  },
  tableButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 0,
    maxHeight: '90%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  modalCloseBtn: {
    fontSize: 24,
    color: '#999',
    fontWeight: '600',
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  modalSection: {
    marginBottom: 24,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
    marginHorizontal: 20,
    marginBottom: 0,
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: '#7c3aed',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  modalDeleteBtn: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  modalDeleteBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
});
