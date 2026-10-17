import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Badge, Card, Icon, IconButton, T, ui } from '../../components/ui';
import { AssistantAnswer, answerQuestion } from '../../lib/domain';
import { useBusiness } from '../../state/business';
import { colors as c, fonts as f } from '../../theme';

type Message = { id: string; role: 'user' | 'assistant'; text: string; answer?: AssistantAnswer };
const suggestions = [
  { icon: 'trending-up-outline' as const, text: 'What are today’s sales?', sub: 'Sales & collections' },
  { icon: 'people-outline' as const, text: 'Who owes me money?', sub: 'Your customer dues' },
  { icon: 'checkmark-done-outline' as const, text: 'What needs my attention?', sub: 'Today’s follow-ups' },
  { icon: 'wallet-outline' as const, text: 'What are total customer dues?', sub: 'See the full picture' },
];
export default function AskScreen() {
  const { state, notify } = useBusiness();
  const params = useLocalSearchParams<{ question?: string }>();
  const [hindi, setHindi] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const list = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usedQuestion = useRef('');
  const send = useCallback((question: string) => {
    const clean = question.trim();
    if (!clean || busy) return;
    const useHindi = hindi || /[\u0900-\u097F]|aaj|kitni|bikri/.test(clean.toLowerCase());
    const result = answerQuestion(clean, state, useHindi);
    setInput(''); setBusy(true);
    setMessages((previous) => [...previous, { id: Date.now() + '-user', role: 'user', text: clean }]);
    timer.current = setTimeout(() => {
      setMessages((previous) => [...previous, { id: Date.now() + '-assistant', role: 'assistant', text: result.text, answer: result }]); setBusy(false);
    }, 450);
  }, [busy, hindi, state]);
  useEffect(() => {
    if (params.question && params.question !== usedQuestion.current) { usedQuestion.current = params.question; send(params.question); }
  }, [params.question, send]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); void Speech.stop(); }, []);
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.background }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 22, paddingTop: 27, paddingBottom: 18, gap: 12 }}>
        <View style={ui.between}><View style={{ gap: 5 }}><T weight="extra" style={{ fontSize: 27, letterSpacing: -1 }}>Just ask Dukanpe<T weight="extra" style={{ color: c.blue, fontSize: 27 }}>.</T></T><T style={{ fontSize: 11, color: c.muted }}>Your shop makes sense here.</T></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Change answer language" onPress={() => setHindi(!hindi)} style={{ padding: 10, backgroundColor: c.white, borderRadius: 11 }}><T weight="bold" style={{ color: c.blue, fontSize: 11 }}>{hindi ? 'हिन्दी' : 'EN'} ⇄</T></Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Badge label="BUSINESS ASSISTANT" /><T style={{ fontSize: 9, color: c.muted }}>Calculated from your saved records</T></View>
      </View>
      <ScrollView ref={list} contentContainerStyle={{ padding: 22, paddingTop: 8, gap: 18, flexGrow: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => { if (messages.length) list.current?.scrollToEnd({ animated: true }); }}>
        {!messages.length && <>
          <View style={{ alignItems: 'center', paddingTop: 18, paddingBottom: 20, gap: 14 }}>
            <View style={{ height: 78, width: 78, borderRadius: 28, backgroundColor: '#E0F5FE', alignItems: 'center', justifyContent: 'center', borderWidth: 6, borderColor: '#EDF9FE' }}><Icon name="sparkles" size={32} color={c.blue} /></View>
            <T weight="extra" style={{ fontSize: 25, letterSpacing: -0.8, textAlign: 'center', lineHeight: 34 }}>A busy shop.{'\n'}A clear answer.</T>
            <T style={{ color: c.muted, fontSize: 12, lineHeight: 21, textAlign: 'center', maxWidth: 280 }}>Ask about sales, payments or a customer. See the records behind every answer.</T>
          </View>
          <View style={{ gap: 10 }}>{suggestions.map((suggestion) => <Pressable key={suggestion.text} accessibilityRole="button" onPress={() => send(suggestion.text)}>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15, borderRadius: 17 }}>
              <View style={{ padding: 10, borderRadius: 12, backgroundColor: c.sky }}><Icon name={suggestion.icon} size={19} color={c.blue} /></View>
              <View style={{ flex: 1, gap: 4 }}><T weight="bold" style={{ fontSize: 12 }}>{suggestion.text}</T><T style={{ color: c.muted, fontSize: 10 }}>{suggestion.sub}</T></View><Icon name="arrow-forward-outline" size={16} color="#B1C0CC" />
            </Card>
          </Pressable>)}</View>
        </>}
        {messages.map((message) => message.role === 'user'
          ? <View key={message.id} style={{ alignSelf: 'flex-end', backgroundColor: c.navy, padding: 15, borderRadius: 18, borderBottomRightRadius: 5, maxWidth: '88%' }}><T style={{ color: c.white, fontSize: 13, lineHeight: 22 }}>{message.text}</T></View>
          : <Card key={message.id} style={{ gap: 13, borderTopLeftRadius: 5 }}>
            <View style={ui.between}><View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="sparkles" color={c.blue} size={14} /><T weight="extra" style={{ fontSize: 11 }}>Dukanpe</T></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Read answer aloud" onPress={() => {
                Speech.stop(); Speech.speak(message.text, { language: /[\u0900-\u097F]/.test(message.text) ? 'hi-IN' : 'en-IN', onError: () => notify('Speech is unavailable. You can read the answer here.') });
              }}><Icon name="volume-medium-outline" size={18} color={c.blue} /></Pressable>
            </View>
            <T style={{ fontSize: 13, lineHeight: 23 }}>{message.text}</T>
            {!!message.answer?.recordIds.length && <View style={{ gap: 7, paddingTop: 9, borderTopWidth: 1, borderTopColor: c.line }}><T weight="bold" style={{ fontSize: 10, color: c.muted }}>SUPPORTING RECORDS</T>
              {message.answer.recordIds.slice(0, 3).map((id) => {
                const record = state.records.find((item) => item.id === id);
                return record && <Pressable accessibilityRole="button" key={id} onPress={() => router.push({ pathname: '/record/[id]', params: { id } })} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 4 }}><Icon name="document-text-outline" size={13} color={c.blue} /><T weight="semi" style={{ fontSize: 10, color: c.blue, flex: 1 }}>{record.title}</T><Icon name="arrow-forward-outline" size={12} color={c.blue} /></Pressable>;
              })}
            </View>}
            {message.answer?.partyId && <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/customer/[id]', params: { id: message.answer!.partyId! } })}><T weight="bold" style={{ color: c.blue, fontSize: 11 }}>Open customer khata →</T></Pressable>}
          </Card>)}
        {busy && <T accessibilityLiveRegion="polite" style={{ color: c.muted, fontSize: 12 }}>Looking through your records…</T>}
      </ScrollView>
      <View style={{ padding: 16, paddingTop: 10, gap: 8, backgroundColor: c.white, borderTopWidth: 1, borderTopColor: c.line }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, backgroundColor: c.ice, borderRadius: 18, padding: 7, paddingLeft: 15 }}>
          <TextInput accessibilityLabel="Ask a business question" value={input} onChangeText={setInput} multiline maxLength={500} placeholder={hindi ? 'अपनी दुकान के बारे में पूछें…' : 'Ask about your business…'} placeholderTextColor="#92A2B4" style={{ flex: 1, minHeight: 42, maxHeight: 110, paddingVertical: 11, fontFamily: f.medium, fontSize: 12, color: c.navy }}
            onSubmitEditing={() => send(input)} />
          <IconButton name="arrow-up-outline" label="Send question" disabled={!input.trim() || busy} onPress={() => send(input)} style={{ backgroundColor: input.trim() && !busy ? c.blue : '#DCE9F2', width: 40, height: 40, borderRadius: 13 }} color={input.trim() && !busy ? c.white : '#8DA7BB'} />
        </View>
        <T style={{ fontSize: 9, color: '#98A8B8', textAlign: 'center' }}>Answers from your records · Speaker reads answers aloud</T>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
