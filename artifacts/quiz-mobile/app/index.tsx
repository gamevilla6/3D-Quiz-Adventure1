import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

type Question = {
  prompt: string;
  options: string[];
  answer: number;
};

const questionBank = {
  'General Knowledge': [
    {
      prompt: 'What is the capital of Japan?',
      options: ['Tokyo', 'Kyoto', 'Osaka', 'Sapporo'],
      answer: 0,
    },
    {
      prompt: "Which is Earth's largest ocean?",
      options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'],
      answer: 3,
    },
    {
      prompt: 'The Eiffel Tower is in which city?',
      options: ['Rome', 'Paris', 'Madrid', 'Vienna'],
      answer: 1,
    },
    {
      prompt: 'How many sides does a hexagon have?',
      options: ['Five', 'Six', 'Seven', 'Eight'],
      answer: 1,
    },
  ],
  Science: [
    {
      prompt: 'Which planet is known as the Red Planet?',
      options: ['Venus', 'Mars', 'Jupiter', 'Mercury'],
      answer: 1,
    },
    {
      prompt: 'What is the chemical formula for water?',
      options: ['CO2', 'O2', 'H2O', 'NaCl'],
      answer: 2,
    },
    {
      prompt: 'What star is at the center of our solar system?',
      options: ['Sirius', 'Polaris', 'The Sun', 'Vega'],
      answer: 2,
    },
  ],
  Technology: [
    {
      prompt: 'What does CPU stand for?',
      options: [
        'Central Processing Unit',
        'Computer Power Utility',
        'Core Program Unit',
        'Central Peripheral User',
      ],
      answer: 0,
    },
    {
      prompt: 'What does HTML stand for?',
      options: [
        'HyperText Markup Language',
        'High Transfer Machine Logic',
        'Home Tool Markup Link',
        'Hyperlink Text Management Layer',
      ],
      answer: 0,
    },
    {
      prompt: 'Which digits are used in binary?',
      options: ['1 and 2', '0 and 1', '2 and 3', '0 and 9'],
      answer: 1,
    },
  ],
} satisfies Record<string, Question[]>;

type Category = keyof typeof questionBank;
type Phase = 'welcome' | 'quiz' | 'results';

const categories: {
  name: Category;
  description: string;
  icon: ComponentProps<typeof Feather>['name'];
  tint: string;
}[] = [
  {
    name: 'General Knowledge',
    description: 'A little bit of everything',
    icon: 'book-open',
    tint: 'blue',
  },
  {
    name: 'Science',
    description: 'The world, wonderfully explained',
    icon: 'activity',
    tint: 'mint',
  },
  {
    name: 'Technology',
    description: 'Ideas that move us forward',
    icon: 'cpu',
    tint: 'coral',
  },
];

function OrbitArtwork({ colors }: { colors: ReturnType<typeof useColors> }) {
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 15000,
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [turn]);

  const rotation = turn.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View
      accessible
      accessibilityLabel="A softly rotating blue planet with mint orbit rings"
      style={[styles.artwork, { backgroundColor: colors.artSurface }]}
    >
      <Animated.View
        style={[
          styles.orbitRing,
          styles.orbitRingOuter,
          { borderColor: colors.mintLine, transform: [{ rotate: rotation }, { rotateX: '65deg' }] },
        ]}
      />
      <Animated.View
        style={[
          styles.orbitRing,
          styles.orbitRingInner,
          { borderColor: colors.primaryLine, transform: [{ rotate: rotation }, { rotateX: '65deg' }] },
        ]}
      />
      <View
        style={[
          styles.planet,
          {
            backgroundColor: colors.primary,
            shadowColor: colors.primary,
          },
        ]}
      >
        <View style={[styles.planetFacet, { backgroundColor: colors.primaryLight }]} />
      </View>
      <View style={[styles.orbitDot, { backgroundColor: colors.mint }]} />
      <View style={[styles.artworkSpark, styles.sparkOne, { backgroundColor: colors.coral }]} />
      <View style={[styles.artworkSpark, styles.sparkTwo, { backgroundColor: colors.gold }]} />
    </View>
  );
}

export default function QuizHomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('welcome');
  const [category, setCategory] = useState<Category>('General Knowledge');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  const questions = questionBank[category];
  const currentQuestion = questions[questionIndex];
  const isCorrect = selectedAnswer === currentQuestion?.answer;

  function startQuiz(nextCategory: Category) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setCategory(nextCategory);
    setQuestionIndex(0);
    setSelectedAnswer(null);
    setScore(0);
    setPhase('quiz');
  }

  function chooseAnswer(answerIndex: number) {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(answerIndex);
    if (answerIndex === currentQuestion.answer) {
      setScore((previous) => previous + 1);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => {},
      );
    } else {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => {},
      );
    }
  }

  function continueRound() {
    if (selectedAnswer === null) return;
    if (questionIndex === questions.length - 1) {
      setPhase('results');
      return;
    }
    setQuestionIndex((previous) => previous + 1);
    setSelectedAnswer(null);
  }

  const shellPadding = {
    paddingTop:
      Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top + 8,
    paddingBottom:
      Platform.OS === 'web' ? Math.max(insets.bottom, 34) : insets.bottom + 12,
  };

  return (
    <SafeAreaView
      edges={['left', 'right']}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      <ScrollView
        contentContainerStyle={[styles.page, shellPadding]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topbar}>
          <View style={styles.brand}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
              <Feather name="aperture" size={18} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.brandName, { color: colors.foreground }]}>
              quiz orbit
            </Text>
          </View>
          <View style={styles.topNote}>
            <View style={[styles.liveDot, { backgroundColor: colors.mint }]} />
            <Text style={[styles.topNoteText, { color: colors.mutedForeground }]}>
              A little room for curiosity
            </Text>
          </View>
        </View>

        {phase === 'welcome' && (
          <View style={styles.welcomeContent}>
            <View
              style={[
                styles.heroCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.cardBorder,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <Text style={[styles.eyebrow, { color: colors.eyebrow }]}>
                A quiz with a little perspective
              </Text>
              <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                Wonder a little <Text style={{ color: colors.primary }}>further.</Text>
              </Text>
              <Text style={[styles.heroDescription, { color: colors.mutedForeground }]}>
                Three curious corners. Ten good questions. See where your
                knowledge takes you.
              </Text>
              <OrbitArtwork colors={colors} />
              <View style={styles.heroCaption}>
                <Feather name="move" size={13} color={colors.mutedForeground} />
                <Text style={[styles.heroCaptionText, { color: colors.mutedForeground }]}>
                  Explore at your own pace
                </Text>
              </View>
            </View>

            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Choose your orbit
              </Text>
              <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>
                Pick a subject · no timer
              </Text>
            </View>

            <View style={styles.categoryList}>
              {categories.map((item, index) => {
                const tintColor =
                  item.tint === 'mint'
                    ? colors.mint
                    : item.tint === 'coral'
                      ? colors.coral
                      : colors.primary;
                const tintSurface =
                  item.tint === 'mint'
                    ? colors.mintSurface
                    : item.tint === 'coral'
                      ? colors.coralSurface
                      : colors.primarySurface;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: category === item.name }}
                    key={item.name}
                    onPress={() => setCategory(item.name)}
                    style={({ pressed }) => [
                      styles.categoryCard,
                      {
                        backgroundColor:
                          category === item.name ? colors.primarySurface : colors.card,
                        borderColor:
                          category === item.name ? colors.primaryLine : colors.cardBorder,
                        borderWidth: category === item.name ? 1.5 : 1,
                        shadowColor: colors.shadow,
                        transform: [{ scale: pressed ? 0.985 : 1 }],
                      },
                    ]}
                    testID={`category-${item.name.toLowerCase().replaceAll(' ', '-')}`}
                  >
                    <View
                      style={[
                        styles.categoryIcon,
                        { backgroundColor: tintSurface },
                      ]}
                    >
                      <Feather name={item.icon} size={19} color={tintColor} />
                    </View>
                    <View style={styles.categoryCopy}>
                      <Text style={[styles.categoryTitle, { color: colors.foreground }]}>
                        {item.name}
                      </Text>
                      <Text style={[styles.categoryDescription, { color: colors.mutedForeground }]}>
                        {item.description}
                      </Text>
                    </View>
                    <Text style={[styles.questionPill, { color: colors.mutedForeground, backgroundColor: colors.surfaceSubtle }]}>
                      {questionBank[item.name].length} Q
                    </Text>
                    <Feather
                      name={category === item.name ? 'check-circle' : 'chevron-right'}
                      size={18}
                      color={category === item.name ? colors.primary : colors.mutedForeground}
                    />
                    {index < categories.length - 1 && (
                      <View style={[styles.categoryAccent, { backgroundColor: tintColor }]} />
                    )}
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => startQuiz(category)}
              style={({ pressed }) => [
                styles.primaryButton,
                styles.startButton,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}
              testID="start-game"
            >
              <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                Start game
              </Text>
              <Feather name="arrow-right" size={16} color={colors.primaryForeground} />
            </Pressable>

            <View style={styles.welcomeFoot}>
              <View style={styles.footItem}>
                <Feather name="check" size={14} color={colors.mint} />
                <Text style={[styles.footText, { color: colors.mutedForeground }]}>
                  10 questions in total
                </Text>
              </View>
              <View style={styles.footItem}>
                <Feather name="zap" size={14} color={colors.primary} />
                <Text style={[styles.footText, { color: colors.mutedForeground }]}>
                  Instant answers
                </Text>
              </View>
            </View>
          </View>
        )}

        {phase === 'quiz' && (
          <View style={styles.quizContent}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPhase('welcome')}
              style={styles.backButton}
              testID="choose-subject"
            >
              <Feather name="arrow-left" size={16} color={colors.mutedForeground} />
              <Text style={[styles.backButtonText, { color: colors.mutedForeground }]}>
                Choose another subject
              </Text>
            </Pressable>

            <View
              style={[
                styles.quizCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.cardBorder,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <View style={styles.quizMeta}>
                <View style={[styles.categoryTag, { backgroundColor: colors.primarySurface }]}>
                  <View style={[styles.tagDot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.categoryTagText, { color: colors.primary }]}>
                    {category}
                  </Text>
                </View>
                <Text style={[styles.questionCount, { color: colors.mutedForeground }]}>
                  {String(questionIndex + 1).padStart(2, '0')} /{' '}
                  {String(questions.length).padStart(2, '0')}
                </Text>
              </View>

              <View style={[styles.progressTrack, { backgroundColor: colors.progressTrack }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${((questionIndex + (selectedAnswer !== null ? 1 : 0)) / questions.length) * 100}%`,
                      backgroundColor: colors.primary,
                    },
                  ]}
                />
              </View>

              <Text style={[styles.questionKicker, { color: colors.mutedForeground }]}>
                Take a moment
              </Text>
              <Text
                accessibilityRole="header"
                style={[styles.questionTitle, { color: colors.foreground }]}
                testID="question-prompt"
              >
                {currentQuestion.prompt}
              </Text>
              <View style={styles.options}>
                {currentQuestion.options.map((option, index) => {
                  const isAnswer = index === currentQuestion.answer;
                  const isPicked = index === selectedAnswer;
                  const answerColor = isAnswer
                    ? colors.mint
                    : isPicked
                      ? colors.coral
                      : colors.foreground;
                  const answerBackground = isAnswer
                    ? colors.mintSurface
                    : isPicked
                      ? colors.coralSurface
                      : colors.surfaceSubtle;
                  const answerBorder = isAnswer
                    ? colors.mintLine
                    : isPicked
                      ? colors.coralLine
                      : colors.border;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: selectedAnswer !== null }}
                      disabled={selectedAnswer !== null}
                      key={`${questionIndex}-${option}`}
                      onPress={() => chooseAnswer(index)}
                      style={({ pressed }) => [
                        styles.option,
                        {
                          backgroundColor:
                            selectedAnswer !== null && !isPicked && !isAnswer
                              ? colors.card
                              : answerBackground,
                          borderColor:
                            selectedAnswer !== null && !isPicked && !isAnswer
                              ? colors.border
                              : answerBorder,
                          opacity:
                            selectedAnswer !== null && !isPicked && !isAnswer
                              ? 0.58
                              : 1,
                          transform: [{ scale: pressed ? 0.99 : 1 }],
                        },
                      ]}
                      testID={`answer-${index + 1}`}
                    >
                      <View
                        style={[
                          styles.optionKey,
                          {
                            backgroundColor:
                              selectedAnswer !== null && (isAnswer || isPicked)
                                ? answerColor
                                : colors.surfaceSubtle,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.optionKeyText,
                            {
                              color:
                                selectedAnswer !== null && (isAnswer || isPicked)
                                  ? colors.primaryForeground
                                  : colors.mutedForeground,
                            },
                          ]}
                        >
                          {String.fromCharCode(65 + index)}
                        </Text>
                      </View>
                      <Text style={[styles.optionText, { color: colors.foreground }]}>
                        {option}
                      </Text>
                      {selectedAnswer !== null && (isAnswer || isPicked) && (
                        <Feather
                          name={isAnswer ? 'check-circle' : 'x-circle'}
                          size={18}
                          color={answerColor}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.feedbackRow} accessibilityLiveRegion="polite">
                {selectedAnswer === null ? (
                  <>
                    <Feather name="info" size={15} color={colors.mutedForeground} />
                    <Text style={[styles.feedbackText, { color: colors.mutedForeground }]}>
                      Choose the answer that feels right.
                    </Text>
                  </>
                ) : (
                  <>
                    <Feather
                      name={isCorrect ? 'check-circle' : 'rotate-ccw'}
                      size={15}
                      color={isCorrect ? colors.mint : colors.coral}
                    />
                    <Text
                      style={[
                        styles.feedbackText,
                        { color: isCorrect ? colors.mint : colors.coral },
                      ]}
                    >
                      {isCorrect
                        ? 'That’s right. Nicely done.'
                        : `Not quite — the answer is ${currentQuestion.options[currentQuestion.answer]}.`}
                    </Text>
                  </>
                )}
              </View>

              <View style={styles.quizFooter}>
                <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>
                  Score <Text style={{ color: colors.foreground }}>{score}</Text>
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={selectedAnswer === null}
                  onPress={continueRound}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    {
                      backgroundColor: colors.primary,
                      opacity: selectedAnswer === null ? 0.45 : pressed ? 0.88 : 1,
                    },
                  ]}
                  testID="next-question"
                >
                  <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                    {questionIndex === questions.length - 1
                      ? 'See your score'
                      : 'Next question'}
                  </Text>
                  <Feather name="arrow-right" size={16} color={colors.primaryForeground} />
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {phase === 'results' && (
          <View style={styles.resultsContent}>
            <View
              style={[
                styles.resultCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.cardBorder,
                  shadowColor: colors.shadow,
                },
              ]}
            >
              <OrbitArtwork colors={colors} />
              <Text style={[styles.eyebrow, { color: colors.eyebrow }]}>
                {category} · complete
              </Text>
              <Text style={[styles.resultTitle, { color: colors.foreground }]}>
                {score === questions.length
                  ? 'Brilliantly done.'
                  : score / questions.length >= 0.6
                    ? 'Look at you go.'
                    : score / questions.length <= 0.3
                      ? 'Curiosity looks good on you.'
                      : 'A lovely little round.'}
              </Text>
              <Text style={[styles.resultMessage, { color: colors.mutedForeground }]}>
                {score === questions.length
                  ? 'A wonderfully sharp orbit. You knew your way around.'
                  : 'You followed your curiosity all the way through.'}
              </Text>
              <View style={styles.resultScoreRow}>
                <Text style={[styles.resultScore, { color: colors.foreground }]}>
                  {score}
                </Text>
                <Text style={[styles.resultDenominator, { color: colors.mutedForeground }]}>
                  {' '}/ {questions.length}
                </Text>
              </View>
              <View style={[styles.resultDivider, { backgroundColor: colors.border }]} />
              <View style={styles.resultStats}>
                <View style={styles.resultStat}>
                  <Text style={[styles.resultStatValue, { color: colors.foreground }]}>
                    {score}
                  </Text>
                  <Text style={[styles.resultStatLabel, { color: colors.mutedForeground }]}>
                    Correct
                  </Text>
                </View>
                <View style={styles.resultStat}>
                  <Text style={[styles.resultStatValue, { color: colors.foreground }]}>
                    {category}
                  </Text>
                  <Text style={[styles.resultStatLabel, { color: colors.mutedForeground }]}>
                    Category
                  </Text>
                </View>
                <View style={styles.resultStat}>
                  <Text style={[styles.resultStatValue, { color: colors.foreground }]}>
                    {questions.length}
                  </Text>
                  <Text style={[styles.resultStatLabel, { color: colors.mutedForeground }]}>
                    Questions
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => startQuiz(category)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.resultPrimaryButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.88 : 1,
                  },
                ]}
                testID="play-again"
              >
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                  Play again
                </Text>
                <Feather name="rotate-cw" size={16} color={colors.primaryForeground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPhase('welcome')}
                style={styles.chooseAnotherButton}
                testID="choose-another-category"
              >
                <Text style={[styles.chooseAnotherText, { color: colors.mutedForeground }]}>
                  Choose another subject
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  page: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  topbar: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 42,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    letterSpacing: -0.8,
  },
  topNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 5,
  },
  topNoteText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  welcomeContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingTop: 22,
  },
  heroCard: {
    padding: 20,
    borderWidth: 1,
    borderRadius: 27,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 15 },
    shadowOpacity: 0.09,
    shadowRadius: 30,
    elevation: 3,
  },
  eyebrow: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  heroTitle: {
    maxWidth: 390,
    marginTop: 13,
    fontFamily: 'Inter_700Bold',
    fontSize: 37,
    lineHeight: 40,
    letterSpacing: -2.2,
  },
  heroDescription: {
    maxWidth: 430,
    marginTop: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 21,
  },
  artwork: {
    height: 110,
    marginTop: 18,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitRing: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 999,
  },
  orbitRingOuter: {
    width: 224,
    height: 83,
  },
  orbitRingInner: {
    width: 172,
    height: 68,
  },
  planet: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '17deg' }],
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  planetFacet: {
    width: 17,
    height: 17,
    borderRadius: 8,
    opacity: 0.7,
    transform: [{ translateX: -5 }, { translateY: -5 }],
  },
  orbitDot: {
    position: 'absolute',
    width: 11,
    height: 11,
    borderRadius: 6,
    top: 37,
    right: '26%',
  },
  artworkSpark: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  sparkOne: {
    left: '22%',
    top: 40,
  },
  sparkTwo: {
    right: '22%',
    bottom: 32,
  },
  heroCaption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingTop: 10,
  },
  heroCaptionText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
  sectionHeading: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    letterSpacing: -0.6,
  },
  sectionHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  categoryList: {
    gap: 8,
  },
  categoryCard: {
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.045,
    shadowRadius: 16,
    elevation: 1,
  },
  startButton: {
    width: '100%',
    marginTop: 14,
  },
  categoryAccent: {
    position: 'absolute',
    left: 0,
    top: 13,
    bottom: 13,
    width: 3,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  categoryIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  categoryCopy: {
    flex: 1,
  },
  categoryTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  categoryDescription: {
    marginTop: 4,
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  questionPill: {
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
  },
  welcomeFoot: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 16,
    paddingTop: 18,
    paddingBottom: 13,
  },
  footItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  footText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
  },
  quizContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingTop: 26,
  },
  backButton: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButtonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  quizCard: {
    marginTop: 8,
    padding: 20,
    borderWidth: 1,
    borderRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 3,
  },
  quizMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryTag: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  tagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  categoryTagText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  questionCount: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 5,
    marginTop: 17,
    marginBottom: 27,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  questionKicker: {
    marginBottom: 10,
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  questionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -1.1,
  },
  options: {
    gap: 9,
    marginTop: 22,
  },
  option: {
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  optionKey: {
    width: 29,
    height: 29,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  optionKeyText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
  },
  optionText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
  },
  feedbackRow: {
    minHeight: 49,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  feedbackText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 17,
  },
  quizFooter: {
    paddingTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  scoreLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 15,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  primaryButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  resultsContent: {
    width: '100%',
    maxWidth: 580,
    alignSelf: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingTop: 28,
    paddingBottom: 28,
  },
  resultCard: {
    paddingHorizontal: 21,
    paddingTop: 20,
    paddingBottom: 18,
    borderWidth: 1,
    borderRadius: 26,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
    elevation: 3,
  },
  resultTitle: {
    marginTop: 12,
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
    fontSize: 27,
    letterSpacing: -1.2,
  },
  resultMessage: {
    marginTop: 8,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 19,
  },
  resultScoreRow: {
    marginTop: 17,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  resultScore: {
    fontFamily: 'Inter_700Bold',
    fontSize: 61,
    letterSpacing: -3,
    fontVariant: ['tabular-nums'],
  },
  resultDenominator: {
    fontFamily: 'Inter_500Medium',
    fontSize: 19,
  },
  resultDivider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    marginVertical: 17,
  },
  resultStats: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 8,
  },
  resultStat: {
    flex: 1,
    alignItems: 'center',
  },
  resultStatValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    textAlign: 'center',
  },
  resultStatLabel: {
    marginTop: 5,
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  resultPrimaryButton: {
    width: '100%',
    marginTop: 22,
  },
  chooseAnotherButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chooseAnotherText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
});
