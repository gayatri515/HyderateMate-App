// App.js
import React, { useEffect, useState, createContext, useContext, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, Switch,
  Dimensions, Animated, Platform, SafeAreaView, StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import { LineChart } from 'react-native-chart-kit';
import { LinearGradient } from 'expo-linear-gradient';

// -------------------- Context --------------------
const AppContext = createContext();
function useApp() { return useContext(AppContext); }

// -------------------- Helper Functions --------------------
const STORAGE_KEYS = {
  USER: 'HM_userData_v2',
  INTAKE_LOG: 'HM_intakeLog_v2',
  SETTINGS: 'HM_settings_v2',
  NOTIF_IDS: 'HM_notif_ids_v2'
};

function formatDate(date = new Date()) { return dayjs(date).format('YYYY-MM-DD'); }

async function loadJson(key, fallback) {
  try { const s = await AsyncStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
  catch (e) { return fallback; }
}
async function saveJson(key, val) {
  try { await AsyncStorage.setItem(key, JSON.stringify(val)); }
  catch (e) { console.warn('save error', e); }
}

// -------------------- Theme --------------------
function makeTheme(isDark) {
  if (!isDark) {
    return {
      background: '#f6fbff',
      surface: '#ffffff',
      card: 'rgba(255,255,255,0.95)',
      primary: '#0077b6',
      accent: '#00b4d8',
      text: '#083344',
      subtext: '#666',
      border: '#e6f0f4',
      inputBg: '#fff',
      wave: '#00bfff',
      topbar: '#05668d',
      statusBarStyle: 'dark-content',
      gradientLight: ['#e0f7ff', '#cfeefd'],
      gradientPrimary: ['#00b4d8', '#0077b6']
    };
  } else {
    return {
      background: '#071023',
      surface: '#0b1220',
      card: '#0f1724',
      primary: '#5dd6ff',
      accent: '#4fb6d9',
      text: '#e6f7ff',
      subtext: '#a9c7d7',
      border: '#122033',
      inputBg: '#071323',
      wave: '#2bb7ff',
      topbar: '#7ad0ff',
      statusBarStyle: 'light-content',
      gradientLight: ['#042033', '#063142'],
      gradientPrimary: ['#036b8f', '#024b6a']
    };
  }
}

// -------------------- Notifications Setup --------------------
async function registerForPushNotificationsAsync() {
  if (!Constants.isDevice) {
    console.warn('Must use physical device for notifications');
    return false;
  }
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  return finalStatus === 'granted';
}

async function cancelScheduledNotificationsAndClearStorage() {
  try {
    const ids = await loadJson(STORAGE_KEYS.NOTIF_IDS, []);
    if (Array.isArray(ids)) {
      await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id)));
    }
    await saveJson(STORAGE_KEYS.NOTIF_IDS, []);
  } catch (e) { console.warn('cancel notifs err', e); }
}

/**
 * scheduleReminders(user, settings)
 */
async function scheduleReminders(user, settings) {
  try {
    await cancelScheduledNotificationsAndClearStorage();

    if (!user || !settings || !settings.remindersEnabled) return [];

    const [wakeH, wakeM] = (user?.wakeTime || settings?.wakeTime || '07:00').split(':').map(Number);
    const [bedH, bedM] = (user?.bedTime || settings?.bedTime || '23:00').split(':').map(Number);
    const interval = Math.max(15, (settings.reminderIntervalMins || 120)); // min 15 min

    const wakeMinutes = (wakeH || 7) * 60 + (wakeM || 0);
    let bedMinutes = (bedH || 23) * 60 + (bedM || 0);
    if (bedMinutes <= wakeMinutes) bedMinutes += 24 * 60;

    const times = [];
    for (let t = wakeMinutes; t <= bedMinutes; t += interval) {
      const minutesOfDay = t % (24 * 60);
      const hour = Math.floor(minutesOfDay / 60);
      const minute = Math.floor(minutesOfDay % 60);
      times.push({ hour, minute });
    }
    if (times.length === 0) times.push({ hour: wakeH, minute: wakeM });

    const ok = await registerForPushNotificationsAsync();
    if (!ok) {
      console.warn('No push permission; skipping scheduling');
      return [];
    }

    const createdIds = [];
    for (const tm of times) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: "HydrateMate ⛲",
          body: "Time to drink water — tap to log quickly!",
          data: { screen: 'Home' }
        },
        trigger: {
          hour: tm.hour,
          minute: tm.minute,
          repeats: true
        }
      });
      createdIds.push(id);
    }
    await saveJson(STORAGE_KEYS.NOTIF_IDS, createdIds);
    console.log('Scheduled reminders', createdIds.length);
    return createdIds;
  } catch (e) { console.warn('scheduleReminders err', e); return []; }
}

// -------------------- App Provider --------------------
function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [intakeLog, setIntakeLog] = useState([]);
  const [settings, setSettings] = useState({ darkMode: false, remindersEnabled: true, reminderIntervalMins: 120, wakeTime: '07:00', bedTime: '23:00' });
  const [notifReady, setNotifReady] = useState(false);

  // load saved data
  useEffect(() => {
    (async () => {
      const savedUser = await loadJson(STORAGE_KEYS.USER, null);
      const savedLog = await loadJson(STORAGE_KEYS.INTAKE_LOG, []);
      const savedSettings = await loadJson(STORAGE_KEYS.SETTINGS, settings);
      setUser(savedUser);
      setIntakeLog(savedLog);
      setSettings(prev => ({ ...prev, ...(savedSettings || {}) }));
    })();
  }, []);

  useEffect(() => { saveJson(STORAGE_KEYS.USER, user); }, [user]);
  useEffect(() => { saveJson(STORAGE_KEYS.INTAKE_LOG, intakeLog); }, [intakeLog]);
  useEffect(() => { saveJson(STORAGE_KEYS.SETTINGS, settings); }, [settings]);

  useEffect(() => {
    (async () => {
      const ok = await registerForPushNotificationsAsync();
      setNotifReady(ok);
      if (settings.remindersEnabled) {
        await scheduleReminders(user, settings);
      } else {
        await cancelScheduledNotificationsAndClearStorage();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, settings.remindersEnabled, settings.reminderIntervalMins, settings.wakeTime, settings.bedTime]);

  const addIntake = (amount, type = 'water') => {
    if (!user) return;
    const today = formatDate();
    const cloned = [...intakeLog];
    const idx = cloned.findIndex(r => r.date === today);
    if (idx >= 0) cloned[idx].intake += amount;
    else cloned.push({ date: today, intake: amount });
    setIntakeLog(cloned);
  };

  const resetToday = () => {
    const today = formatDate();
    const cloned = intakeLog.filter(r => r.date !== today);
    setIntakeLog(cloned);
  };

  const theme = makeTheme(settings.darkMode);

  const value = { user, setUser, intakeLog, setIntakeLog, addIntake, resetToday, settings, setSettings, notifReady, theme };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// -------------------- Small UI Helpers --------------------
function TopBar({ title }) {
  const { theme } = useApp();
  return (
    <View style={[styles.topbar, { backgroundColor: 'transparent' }]}>
      <Text style={[styles.topbarTitle, { color: theme.topbar }]}>{title}</Text>
    </View>
  );
}

// -------------------- Welcome Screen --------------------
function WelcomeScreen({ navigation }) {
  const { setUser, setSettings, settings, theme } = useApp();
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');
  const [age, setAge] = useState('');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [bedTime, setBedTime] = useState('23:00');

  const calculateWaterGoal = () => {
    const w = parseFloat(weight); const a = parseInt(age);
    if (!w || !a) return 2000;
    let ml = w * 35;
    if (a < 30) ml *= 1.05; else if (a > 55) ml *= 0.9;
    return Math.round(ml);
  };

  const onStart = async () => {
    if (!name || !weight || !age) { Alert.alert('Please fill required fields'); return; }
    const goal = calculateWaterGoal();
    const userObj = { name, weight: parseFloat(weight), age: parseInt(age), wakeTime, bedTime, goal, createdAt: new Date().toISOString() };
    setUser(userObj);
    setSettings(s => ({ ...s, wakeTime, bedTime }));
    await saveJson(STORAGE_KEYS.USER, userObj);
    if (navigation && navigation.replace) navigation.replace('MainTabs');
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar barStyle={theme.statusBarStyle} />
      <LinearGradient colors={theme.gradientLight} style={styles.centered}>
        <Text style={[styles.welcomeTitle, { color: theme.text }]}>Welcome to HydrateMate</Text>
        <Text style={[styles.welcomeSubtitle, { color: theme.subtext }]}>Personalize your hydration plan</Text>

        <View style={[styles.welcomeCard, { backgroundColor: theme.card }]}>
          <TextInput
            placeholder="Name"
            placeholderTextColor={theme.subtext}
            style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]}
            value={name} onChangeText={setName} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <TextInput placeholder="Weight (kg)" placeholderTextColor={theme.subtext} style={[styles.input, { width: '48%', backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} value={weight} onChangeText={setWeight} keyboardType="numeric" />
            <TextInput placeholder="Age" placeholderTextColor={theme.subtext} style={[styles.input, { width: '48%', backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} value={age} onChangeText={setAge} keyboardType="numeric" />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <TextInput placeholder="Wake-up (HH:MM)" placeholderTextColor={theme.subtext} style={[styles.input, { width: '48%', backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} value={wakeTime} onChangeText={setWakeTime} />
            <TextInput placeholder="Bedtime (HH:MM)" placeholderTextColor={theme.subtext} style={[styles.input, { width: '48%', backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} value={bedTime} onChangeText={setBedTime} />
          </View>
          <Text style={[styles.help, { color: theme.subtext }]}>Recommended goal: <Text style={{ fontWeight: '700', color: theme.text }}>{calculateWaterGoal()} ml</Text></Text>

          <TouchableOpacity style={styles.startBtn} onPress={onStart}>
            <LinearGradient colors={theme.gradientPrimary} style={styles.btnGrad}>
              <Text style={styles.btnText}>Get Started</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
}

// -------------------- Home Screen --------------------
function HomeScreen() {
  const { user, intakeLog, addIntake, settings, theme } = useApp();
  const [input, setInput] = useState('');
  const [message, setMessage] = useState('');
  const [showConfetti, setShowConfetti] = useState(false);

  const today = formatDate();
  const todayEntry = intakeLog.find(r => r.date === today) || { date: today, intake: 0 };
  const intake = todayEntry.intake;
  const goal = user?.goal || 2000;
  const progress = Math.min(intake / goal, 1);

  const waveAnim = useRef(new Animated.Value(progress)).current;
  useEffect(() => {
    Animated.timing(waveAnim, { toValue: progress, duration: 900, useNativeDriver: false }).start();
  }, [progress]);

  const handleAdd = () => {
    const n = parseInt(input);
    if (!n || n <= 0) { Alert.alert('Enter positive ml'); return; }
    addIntake(n);
    setInput('');
    const tips = ['Keep sipping!', 'Great job!', 'Hydration boost!', 'Nice!'];
    setMessage(tips[Math.floor(Math.random() * tips.length)]);
    if (intake + n >= goal) {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
      Alert.alert('🎉 Goal reached', 'You reached your daily water goal!');
    }
  };

  const waveHeight = waveAnim.interpolate({ inputRange: [0,1], outputRange: ['0%', '100%'] });

  return (
    <ScrollView contentContainerStyle={[styles.screen, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={theme.statusBarStyle} />
      <TopBar title={`Hello, ${user?.name || 'Friend'}`} />
      <LinearGradient colors={[theme.surface, theme.background]} style={[styles.headerCard, { backgroundColor: theme.surface }]}>
        <Text style={[styles.title, { color: theme.text }]}>Daily goal: <Text style={{ color: theme.primary }}>{goal} ml</Text></Text>
        <Text style={[styles.sub, { color: theme.subtext }]}>Today: <Text style={{ fontWeight: '700', color: theme.text }}>{intake} ml</Text></Text>
      </LinearGradient>

      <View style={styles.progressCard}>
        <View style={styles.circleContainer}>
          <Text style={[styles.bigText, { color: theme.primary }]}>{Math.round(progress * 100)}%</Text>
          <Text style={{ color: theme.subtext }}>{intake} / {goal} ml</Text>
        </View>
        <View style={[styles.waveWrapper, { borderColor: theme.border, backgroundColor: theme.card }]}>
          <Animated.View style={[styles.waveFill, { height: waveHeight, backgroundColor: theme.wave }]} />
        </View>
      </View>

      <View style={{ width: '100%', alignItems: 'center' }}>
        <TextInput
          style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]}
          placeholder="Add ml (e.g. 250)"
          placeholderTextColor={theme.subtext}
          value={input} onChangeText={setInput} keyboardType="numeric" />
        <TouchableOpacity style={styles.primaryBtn} onPress={handleAdd}>
          <LinearGradient colors={theme.gradientPrimary} style={styles.btnGrad}>
            <Text style={styles.btnText}>Add</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 8, backgroundColor: theme.card, borderColor: theme.border }]} onPress={() => {
          Alert.alert('Quick add', 'Add a quick 250 ml?', [{ text: 'Cancel' }, { text: 'Add', onPress: () => addIntake(250) }]);
        }}>
          <Text style={{ fontWeight: '600', color: theme.primary }}>Quick +250 ml</Text>
        </TouchableOpacity>

        {message ? <Text style={[styles.help, { color: theme.subtext }]}>{message}</Text> : null}
        {showConfetti ? <Text style={{ marginTop: 8, fontSize: 28 }}>🎊</Text> : null}

        <View style={[styles.summaryCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={{ fontWeight: '600', color: theme.text }}>Remaining: {Math.max(goal - intake, 0)} ml</Text>
          <Text style={{ color: theme.subtext }}>Time left: {computeHoursLeft(user)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function computeHoursLeft(user) {
  try {
    if (!user) return '—';
    const now = dayjs();
    const [bh, bm] = (user.bedTime || '23:00').split(':').map(Number);
    let bed = dayjs().hour(bh).minute(bm);
    if (bed.isBefore(now)) bed = bed.add(1, 'day');
    const diff = bed.diff(now, 'hour');
    return diff > 0 ? `${diff} hrs` : 'few hours';
  } catch (e) { return '—'; }
}

// -------------------- History Screen --------------------
function HistoryScreen() {
  const { intakeLog, theme } = useApp();
  const last7Days = lastNDays(7);
  const last7 = last7Days.map(d => {
    const r = intakeLog.find(i => i.date === d) || { date: d, intake: 0 };
    return r.intake;
  });
  const labels = last7Days.map(d => dayjs(d).format('DD'));

  const chartConfig = {
    backgroundGradientFrom: theme.surface,
    backgroundGradientTo: theme.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `${hexToRgba(theme.primary, opacity)}`,
    labelColor: (opacity = 1) => `${hexToRgba(theme.subtext, opacity)}`,
    propsForDots: { r: '4', strokeWidth: '2' },
  };

  return (
    <ScrollView contentContainerStyle={[styles.screen, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={theme.statusBarStyle} />
      <TopBar title="History" />
      <Text style={[styles.title, { fontSize: 20, color: theme.text }]}>Last 7 days</Text>

      <LineChart
        data={{ labels, datasets: [{ data: last7 }] }}
        width={Dimensions.get('window').width - 32}
        height={220}
        chartConfig={chartConfig}
        bezier
        style={{ borderRadius: 12, marginTop: 8, backgroundColor: theme.surface }}
      />

      <View style={{ marginTop: 16, width: '100%', alignItems: 'center' }}>
        {last7Days.slice().reverse().map(d => {
          const intake = intakeLog.find(i => i.date === d)?.intake || 0;
          return (
            <View key={d} style={[styles.historyRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <Text style={{ color: theme.text }}>{dayjs(d).format('ddd DD MMM')}</Text>
              <Text style={{ fontWeight: '700', color: theme.primary }}>{intake} ml</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}
function lastNDays(n) {
  const arr = [];
  for (let i = n - 1; i >= 0; i--) arr.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
  return arr;
}
function hexToRgba(hex, opacity) {
  // simple helper: converts #rrggbb to rgba(...)
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0,2),16), g = parseInt(h.substring(2,4),16), b = parseInt(h.substring(4,6),16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// -------------------- Settings Screen --------------------
function SettingsScreen() {
  const { user, setUser, settings, setSettings, resetToday, setIntakeLog, theme } = useApp();
  const [editableUser, setEditableUser] = useState(user || {});
  const [customGoal, setCustomGoal] = useState('');

  useEffect(() => {
    setEditableUser(user || {});
    setCustomGoal(user?.goal?.toString() || '');
  }, [user]);

  const saveUserInfo = async () => {
    if (!editableUser.name || !editableUser.weight || !editableUser.age) {
      Alert.alert('⚠️ Please fill all fields');
      return;
    }
    const updated = {
      ...editableUser,
      weight: parseFloat(editableUser.weight),
      age: parseInt(editableUser.age),
      goal: parseInt(customGoal) || editableUser.goal || 2000,
    };
    setUser(updated);
    await saveJson(STORAGE_KEYS.USER, updated);
    Alert.alert('✅ Profile updated successfully!');
  };

  const toggleDark = () => setSettings({ ...settings, darkMode: !settings.darkMode });

  const clearAllData = () => {
    Alert.alert('🧹 Clear All Data', 'Are you sure you want to delete all saved data?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.clear();
          setIntakeLog([]);
          setUser(null);
          Alert.alert('✅ All data cleared');
        },
      },
    ]);
  };

  const sendTestReminder = async () => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '💧 Hydration Reminder',
        body: 'Time to take a sip! Stay hydrated 🌊',
      },
      trigger: null,
    });
    Alert.alert('🔔 Test reminder sent!');
  };

  const initials = editableUser.name
    ? editableUser.name.split(' ').map(w => w[0]).join('').toUpperCase()
    : '?';

  return (
    <LinearGradient colors={theme.gradientLight} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.screen, { padding: 20, backgroundColor: theme.background }]}>
        <StatusBar barStyle={theme.statusBarStyle} />
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <View style={{
            width: 90, height: 90, borderRadius: 45, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center',
            shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, elevation: 6,
          }}>
            <Text style={{ fontSize: 36, color: '#fff', fontWeight: 'bold' }}>{initials}</Text>
          </View>
          <Text style={{ fontSize: 22, marginTop: 10, color: theme.text, fontWeight: '600' }}>
            {editableUser.name || 'Your Name'}
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.primary }]}>👤 Profile Information</Text>
          <TextInput style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} placeholder="Name" placeholderTextColor={theme.subtext} value={editableUser.name || ''} onChangeText={(v) => setEditableUser({ ...editableUser, name: v })} />
          <TextInput style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} placeholder="Age" placeholderTextColor={theme.subtext} keyboardType="numeric" value={editableUser.age?.toString() || ''} onChangeText={(v) => setEditableUser({ ...editableUser, age: v })} />
          <TextInput style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} placeholder="Weight (kg)" placeholderTextColor={theme.subtext} keyboardType="numeric" value={editableUser.weight?.toString() || ''} onChangeText={(v) => setEditableUser({ ...editableUser, weight: v })} />
          <TextInput style={[styles.input, { backgroundColor: theme.inputBg, color: theme.text, borderColor: theme.border }]} placeholder="Daily Goal (ml)" placeholderTextColor={theme.subtext} keyboardType="numeric" value={customGoal} onChangeText={setCustomGoal} />
          <TouchableOpacity style={styles.primaryBtn} onPress={saveUserInfo}>
            <LinearGradient colors={theme.gradientPrimary} style={styles.btnGrad}>
              <Text style={styles.btnText}>💾 Save Changes</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.primary }]}>🌙 Preferences</Text>
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Dark Mode</Text>
            <Switch value={settings.darkMode} onValueChange={toggleDark} />
          </View>
          <View style={styles.settingRow}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Reminders</Text>
            <Switch
              value={settings.remindersEnabled}
              onValueChange={() =>
                setSettings({ ...settings, remindersEnabled: !settings.remindersEnabled })
              }
            />
          </View>

          <TouchableOpacity style={[styles.secondaryBtn, { marginTop: 10, backgroundColor: theme.card, borderColor: theme.border }]} onPress={sendTestReminder}>
            <Text style={{ color: theme.primary, fontWeight: '600' }}>🔔 Test Reminder</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.primary }]}>🧩 Actions</Text>
          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: '#e0f7fa' }]} onPress={resetToday}>
            <Text style={{ color: '#00796b', fontWeight: '600' }}>🔄 Reset Today</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: '#ffe5e5' }]} onPress={clearAllData}>
            <Text style={{ color: '#c62828', fontWeight: '600' }}>🗑️ Clear All Data</Text>
          </TouchableOpacity>
        </View>

        <Text style={{ textAlign: 'center', color: theme.subtext, marginTop: 20 }}>
          💧 HydrateMate | Stay Fresh, Stay Hydrated
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

// -------------------- Achievements Screen --------------------
function AchievementsScreen() {
  const { intakeLog, theme } = useApp();
  const streak = computeStreak(intakeLog);
  const achievements = [];
  if (streak >= 7) achievements.push('7-day Streak');
  if (streak >= 30) achievements.push('30-day Streak');

  const overachiever = intakeLog.some(d => d.intake >= 1.2 * (loadTodayGoalFromStorageSync() || 2000));
  if (overachiever) achievements.push('Overachiever');

  return (
    <ScrollView contentContainerStyle={[styles.screen, { backgroundColor: theme.background }]}>
      <StatusBar barStyle={theme.statusBarStyle} />
      <TopBar title="Achievements" />
      <Text style={[styles.title, { color: theme.text }]}>Achievements</Text>
      {achievements.length === 0 ? <Text style={[styles.help, { color: theme.subtext }]}>No achievements yet — keep going!</Text> : (
        achievements.map((a,i) => (
          <View key={i} style={[styles.achRow, { backgroundColor: theme.card, borderColor: theme.border }]}><Text style={{ fontWeight: '600', color: theme.text }}>🏅 {a}</Text></View>
        ))
      )}
    </ScrollView>
  );
}
function computeStreak(log) {
  const goal = loadTodayGoalFromStorageSync() || 2000;
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
    const entry = log.find(r => r.date === d);
    if (entry && entry.intake >= goal) streak++; else break;
  }
  return streak;
}
function loadTodayGoalFromStorageSync() { return 2000; }

// -------------------- Navigation --------------------
const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <AppProvider>
      <MainApp />
    </AppProvider>
  );
}

function MainApp() {
  const { user, settings, theme } = useApp();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = await registerForPushNotificationsAsync();
      if (ok) console.log('Notifications ready');
      setReady(true);
    })();
  }, []);

  if (!ready) return null;

  // Use react-navigation built-in themes for nav chrome, keep consistent with our theme choice
  const navTheme = settings.darkMode ? DarkTheme : DefaultTheme;

  return (
    <NavigationContainer theme={navTheme}>
      {user ? (
        <Tab.Navigator screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: theme.primary,
          tabBarStyle: { paddingVertical: Platform.OS === 'ios' ? 8 : 4, height: 60, backgroundColor: theme.card },
          tabBarIcon: ({ color, size }) => {
            let name = 'water-outline';
            if (route.name === 'Home') name = 'water-outline';
            if (route.name === 'History') name = 'stats-chart-outline';
            if (route.name === 'Settings') name = 'settings-outline';
            if (route.name === 'Achievements') name = 'trophy-outline';
            return <Ionicons name={name} size={size} color={color} />;
          }
        })}>
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="History" component={HistoryScreen} />
          <Tab.Screen name="Achievements" component={AchievementsScreen} />
          <Tab.Screen name="Settings" component={SettingsScreen} />
        </Tab.Navigator>
      ) : (
        <WelcomeScreen navigation={{ replace: () => setReady(true) }} />
      )}
    </NavigationContainer>
  );
}

// -------------------- Styles --------------------
const styles = StyleSheet.create({
  centered: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },

  screen: {
    flexGrow: 1,
    padding: 16,
    alignItems: 'center',
  },

  topbar: {
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    marginBottom: 6
  },
  topbarTitle: {
    fontSize: 22,
    fontWeight: '700',
  },

  welcomeTitle: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center'
  },
  welcomeSubtitle: {
    marginBottom: 12
  },

  welcomeCard: {
    marginTop: 8,
    width: '100%',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 6
  },

  headerCard: {
    width: '100%',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },

  // ---- Text Styles ----
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginVertical: 6,
    textAlign: 'center'
  },
  sub: {
    fontSize: 14,
    marginBottom: 8
  },
  help: {
    marginTop: 8
  },

  // ---- Input Fields ----
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    width: 300,
    marginTop: 10,
    textAlign: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 2
  },

  // ---- Buttons ----
  primaryBtn: {
    marginTop: 12,
    width: 220,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3
  },
  btnGrad: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16
  },
  startBtn: {
    marginTop: 12,
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden'
  },
  secondaryBtn: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    alignItems: 'center',
    width: 220,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 2
  },

  // ---- Progress & Summary ----
  progressCard: {
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 6
  },
  circleContainer: {
    alignItems: 'center',
    marginBottom: 12
  },
  bigText: {
    fontSize: 48,
    fontWeight: '800',
  },
  waveWrapper: {
    width: 160,
    height: 160,
    borderRadius: 80,
    overflow: 'hidden',
    borderWidth: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 4
  },
  waveFill: {
    width: '100%',
    position: 'absolute',
    bottom: 0
  },

  summaryCard: {
    marginTop: 18,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    width: '90%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2
  },

  // ---- History & Achievement ----
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.3,
    width: Dimensions.get('window').width - 32
  },
  achRow: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    width: Dimensions.get('window').width - 32,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 2
  },

  // ---- Settings Cards ----
  card: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    width: '95%',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
    borderWidth: 1
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  settingLabel: {
    fontSize: 16,
  },
});
