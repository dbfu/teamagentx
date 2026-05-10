// This is a basic Flutter widget test.

import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/app.dart';

void main() {
  testWidgets('App initialization test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const App());
    await tester.pumpAndSettle();

    // Verify that the app loads without crashing
    expect(find.text('TeamAgentX'), findsOneWidget);
  });
}
