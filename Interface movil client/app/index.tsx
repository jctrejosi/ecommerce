import { ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Header } from "../src/components/Header";
import { HeroSection } from "../src/components/landing/HeroSection";
import { QuickCategoriesSection } from "../src/components/landing/QuickCategoriesSection";
import { PromoBanner } from "../src/components/landing/PromoBanner";
import { FeaturedProductsSection } from "../src/components/landing/FeaturedProductsSection";
import { AdvertisingBanner } from "../src/components/landing/AdvertisingBanner";
import { DailyDealsSection } from "../src/components/landing/DailyDealsSection";
import { BrandsSection } from "../src/components/landing/BrandsSection";
import { SucursalesSection } from "../src/components/landing/SucursalesSection";
import { BenefitsSection } from "../src/components/landing/BenefitsSection";
import { NewsletterSection } from "../src/components/landing/NewsletterSection";
import { FooterSection } from "../src/components/landing/FooterSection";
import { PopupDisplay } from "../src/components/PopupDisplay";

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Header
        onSearchSubmit={(q) =>
          router.push({ pathname: "/catalog", params: { search: q } })
        }
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        <HeroSection />
        <QuickCategoriesSection />
        <PromoBanner />
        <FeaturedProductsSection />
        <AdvertisingBanner />
        <DailyDealsSection />
        <BrandsSection />
        <SucursalesSection />
        <BenefitsSection />
        <NewsletterSection />
        <FooterSection />
      </ScrollView>
      <PopupDisplay />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#fff" },
  scroll: { paddingBottom: 0 },
});
