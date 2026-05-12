/**
 * Prepare Training Data for Custom ML Model
 * Extracts data from GamingKnowledge database and formats it for ML training
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const GamingKnowledge = require('../models/GamingKnowledge');
require('dotenv').config();

// Connect to database
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// Format data for different ML frameworks
const formatForTraining = (knowledgeItems) => {
  const formats = {
    // Format for GPT-2, Llama fine-tuning
    conversation: knowledgeItems.map(item => ({
      instruction: item.question,
      input: "",
      output: item.answer,
      language: item.language,
      topic: item.topic,
      game: item.game,
      skillLevel: item.skillLevel
    })),

    // Format for Hugging Face datasets
    huggingface: knowledgeItems.map(item => ({
      text: `Question: ${item.question}\nAnswer: ${item.answer}\n\n`
    })),

    // Format for OpenAI fine-tuning
    openai: knowledgeItems.map(item => ({
      messages: [
        {
          role: "system",
          content: `You are an expert Gaming Coach. Help users improve their gaming skills.`
        },
        {
          role: "user",
          content: item.question
        },
        {
          role: "assistant",
          content: item.answer
        }
      ]
    })),

    // Format for simple text generation
    text: knowledgeItems.map(item => 
      `Question: ${item.question}\nAnswer: ${item.answer}\n\n`
    ).join(''),

    // Format for classification tasks (intent detection)
    classification: knowledgeItems.map(item => ({
      text: item.question,
      label: item.topic,
      language: item.language,
      game: item.game
    }))
  };

  return formats;
};

// Main function
const prepareTrainingData = async () => {
  try {
    await connectDB();
    
    console.log('\n📊 Preparing Training Data...\n');
    
    // Get all active knowledge items
    const knowledgeItems = await GamingKnowledge.find({ isActive: true });
    
    if (knowledgeItems.length === 0) {
      console.log('❌ No knowledge items found in database!');
      console.log('💡 Run: npm run add-knowledge (to add initial knowledge)');
      process.exit(1);
    }
    
    console.log(`✅ Found ${knowledgeItems.length} knowledge items`);
    
    // Get statistics
    const stats = {
      total: knowledgeItems.length,
      byLanguage: {},
      byTopic: {},
      byGame: {}
    };
    
    knowledgeItems.forEach(item => {
      stats.byLanguage[item.language] = (stats.byLanguage[item.language] || 0) + 1;
      stats.byTopic[item.topic] = (stats.byTopic[item.topic] || 0) + 1;
      stats.byGame[item.game] = (stats.byGame[item.game] || 0) + 1;
    });
    
    console.log('\n📈 Statistics:');
    console.log(`   Languages: ${Object.keys(stats.byLanguage).join(', ')}`);
    console.log(`   Topics: ${Object.keys(stats.byTopic).join(', ')}`);
    console.log(`   Games: ${Object.keys(stats.byGame).join(', ')}`);
    
    // Format data for different use cases
    const formattedData = formatForTraining(knowledgeItems);
    
    // Create output directory
    const outputDir = path.join(__dirname, '../../ml-training-data');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Save different formats
    console.log('\n💾 Saving training data files...\n');
    
    // 1. Conversation format (for GPT-2, Llama)
    fs.writeFileSync(
      path.join(outputDir, 'training_data_conversation.json'),
      JSON.stringify(formattedData.conversation, null, 2)
    );
    console.log('✅ Saved: training_data_conversation.json');
    
    // 2. Hugging Face format
    fs.writeFileSync(
      path.join(outputDir, 'training_data_huggingface.json'),
      JSON.stringify(formattedData.huggingface, null, 2)
    );
    console.log('✅ Saved: training_data_huggingface.json');
    
    // 3. OpenAI format
    fs.writeFileSync(
      path.join(outputDir, 'training_data_openai.jsonl'),
      formattedData.openai.map(item => JSON.stringify(item)).join('\n')
    );
    console.log('✅ Saved: training_data_openai.jsonl');
    
    // 4. Simple text format
    fs.writeFileSync(
      path.join(outputDir, 'training_data_text.txt'),
      formattedData.text
    );
    console.log('✅ Saved: training_data_text.txt');
    
    // 5. Classification format
    fs.writeFileSync(
      path.join(outputDir, 'training_data_classification.json'),
      JSON.stringify(formattedData.classification, null, 2)
    );
    console.log('✅ Saved: training_data_classification.json');
    
    // 6. Statistics
    fs.writeFileSync(
      path.join(outputDir, 'training_stats.json'),
      JSON.stringify(stats, null, 2)
    );
    console.log('✅ Saved: training_stats.json');
    
    console.log('\n🎉 Training data prepared successfully!');
    console.log(`\n📁 Output directory: ${outputDir}`);
    console.log('\n📝 Next steps:');
    console.log('   1. Review the training data files');
    console.log('   2. Follow CUSTOM_ML_MODEL_GUIDE.md for training');
    console.log('   3. Use Python scripts to fine-tune your model');
    console.log('\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error preparing training data:', error);
    process.exit(1);
  }
};

// Run
prepareTrainingData();




