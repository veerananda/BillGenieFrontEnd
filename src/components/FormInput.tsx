import React from 'react';
import { StyleSheet, View, TextInput as RNTextInput, Text } from 'react-native';

interface FormInputProps {
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    error?: string;
    secureTextEntry?: boolean;
    keyboardType?: 'default' | 'email-address' | 'numeric' | 'phone-pad';
    autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
    disabled?: boolean;
}

export const FormInput: React.FC<FormInputProps> = ({
    label,
    value,
    onChangeText,
    error,
    secureTextEntry = false,
    keyboardType = 'default',
    autoCapitalize = 'none',
    disabled = false,
}) => {
    return (
        <View style={styles.container}>
            <RNTextInput
                placeholder={label}
                value={value}
                onChangeText={onChangeText}
                secureTextEntry={secureTextEntry}
                keyboardType={keyboardType as any}
                autoCapitalize={autoCapitalize as any}
                editable={!disabled}
                style={[styles.input, error && styles.inputError]}
            />
            {error && (
                <Text style={styles.error}>
                    {error}
                </Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
    input: {
        borderWidth: 1,
        borderColor: '#ccc',
        padding: 12,
        borderRadius: 4,
        fontSize: 16,
        backgroundColor: '#fff',
    },
    inputError: {
        borderColor: '#ff0000',
    },
    error: {
        color: '#ff0000',
        fontSize: 12,
        marginTop: 4,
    },
});