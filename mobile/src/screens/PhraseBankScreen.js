import React, { useState } from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SearchBar } from "react-native";
import { colors } from "../theme/colors.js";
import { theme } from "../theme/index.js";
import Button from "../components/ui/Button.jsx";
import Badge from "../components/ui/Badge.jsx";
import Card from "../components/ui/Card.jsx";

const CATEGORIES = ["All", "Business", "Travel", "Daily", "Academic", "Idioms", "Slang"];

const PHRASE_DATA = [
  { phrase: "Break the ice", meaning: "To start a conversation in a social situation", category: "Social", level: "A2" },
  { phrase: "Hit the nail on the head", meaning: "To describe exactly what is causing a situation", category: "Idioms", level: "B1" },
  { phrase: "Let's touch base", meaning: "To connect with someone at a later time", category: "Business", level: "B1" },
  { phrase: "I'm feeling under the weather", meaning: "To feel sick or unwell", category: "Daily", level: "A2" },
  { phrase: "The ball is in your court", meaning: "It is your decision", category: "Idioms", level: "B2" },
  { phrase: "Spill the beans", meaning: "To reveal a secret", category: "Slang", level: "B1" },
  { phrase: "A piece of cake", meaning: "Something very easy", category: "Idioms", level: "A2" },
  { phrase: "Cutting corners", meaning: "To do something the easiest way", category: "Business", level: "B1" },
];

export default function PhraseBankScreen() {
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [search, setSearch] = useState("");

  const filtered = PHRASE_DATA.filter((p) => {
    const matchCat = selectedCategory === "All" || p.category === selectedCategory;
    const matchSearch = p.phrase.toLowerCase().includes(search.toLowerCase()) || p.meaning.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Phrase Bank</Text>
      <Text style={styles.subtitle}>Browse and save useful English phrases</Text>

      <View style={styles.searchRow}>
        <View style={styles.searchInput}>
          <Text style={styles.searchPlaceholder}>🔍 Search phrases...</Text>
        </View>
      </View>

      <View style={styles.categoryRow}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.categoryChip, selectedCategory === cat && styles.categoryChipActive]}
            onPress={() => setSelectedCategory(cat)}
          >
            <Text style={[styles.categoryText, selectedCategory === cat && styles.categoryTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item, idx) => idx.toString()}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card
            title={item.phrase}
            subtitle={item.meaning}
            style={styles.card}
            variant="default"
          >
            <View style={styles.cardFooter}>
              <Badge variant="primary">{item.level}</Badge>
              <Badge variant="muted">{item.category}</Badge>
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: theme.spacing.lg },
  title: { color: colors.text, fontSize: theme.fontSize.xxl, fontWeight: theme.fontWeight.bold, marginBottom: theme.spacing.xs },
  subtitle: { color: colors.textMuted, fontSize: theme.fontSize.md, marginBottom: theme.spacing.lg },
  searchRow: { marginBottom: theme.spacing.md },
  searchInput: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: theme.borderRadius.md, padding: theme.spacing.md },
  searchPlaceholder: { color: colors.textFaint, fontSize: theme.fontSize.md },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  categoryChip: { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.borderRadius.full, backgroundColor: colors.surfaceRaised },
  categoryChipActive: { backgroundColor: colors.accent },
  categoryText: { color: colors.textMuted, fontSize: theme.fontSize.sm },
  categoryTextActive: { color: "#FFFFFF" },
  list: { paddingBottom: theme.spacing.xxxl },
  card: { marginBottom: theme.spacing.md },
  cardFooter: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
});
