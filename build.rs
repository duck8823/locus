fn main() {
    let config = slint_build::CompilerConfiguration::new()
        .with_bundled_translations("lang")
        // .po 側に msgctxt を持たせない構成にしているため、translation context を
        // component 名で生成しないよう None に倒す。これがないと _SLINT_TRANSLATED_STRINGS
        // の日本語スロットが全部 None になって @tr() が英語 fallback してしまう。
        .with_default_translation_context(slint_build::DefaultTranslationContext::None);
    slint_build::compile_with_config("ui/app.slint", config).unwrap();
}
